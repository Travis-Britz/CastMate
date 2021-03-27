const { ElectronAuthManager } = require("../utils/twitchAuth");

const { ApiClient } = require("twitch");

const { ChatClient } = require("twitch-chat-client");

const { PubSubClient, BasicPubSubClient } = require("twitch-pubsub-client");

const { WebHookListener, ConnectionAdapter } = require("twitch-webhooks");

const { template } = require('../utils/template');
const { evalTemplate } = require('../utils/template');
const HotReloader = require("../utils/hot-reloader");

const BadWords = require("bad-words");

const { ipcMain } = require("electron");

const express = require('express');


class ExpressWebhookAdapter extends ConnectionAdapter
{
	constructor(options, basePath)
	{
		super(options);
		this._hostName = options.hostName;
		this._basePath = basePath;
	}

	/** @protected */
	get connectUsingSsl()
	{
		return this.listenUsingSsl;
	}
	/** @protected */
	async getExternalPort()
	{
		return this.getListenerPort();
	}

	/** @protected */
	async getHostName()
	{
		return this._hostName;
	}

	get pathPrefix()
	{
		return this._basePath;
	}
}


module.exports = {
	name: "twitch",
	async init()
	{
		console.log("Starting Twitch");

		await this.doInitialAuth();

		this.setupSettingsIPC();

		this.colorCache = {};

		this.filter = new BadWords();//{ emptyList: true }); //Temporarily Disable the custom bad words list.
		//this.filter.addWords(...badwordList.words);
	},
	methods: {
		filterMessage(message)
		{
			if (!message || message.length < 2)
				return message;

			if (!this.filter)
				return "";

			return this.filter.clean(message)
		},

		async doInitialAuth()
		{
			this.channelAuth = new ElectronAuthManager({ clientId: this.secrets.apiClientId, redirectUri: `http://localhost/auth/channel/redirect`, name: "Channel" })
			this.botAuth = new ElectronAuthManager({ clientId: this.secrets.apiClientId, redirectUri: `http://localhost/auth/channel/redirect`, name: "Bot" })

			await this.channelAuth.trySilentAuth();
			await this.botAuth.trySilentAuth();


			await this.completeAuth();

		},

		async shutdown()
		{
			if (this.chatClient)
			{
				await this.chatClient.quit();
			}

			if (this.webhooks)
			{
				for (let sub of this.webhookSubs)
				{
					sub.stop();
				}

				let index = this.webServices.app._router.stack.findIndex((item) => item.handle == this.webhookRouter)
				if (index >= 0)
				{
					console.log("Removing router by index", index);
					this.webServices.app._router.stack.splice(index, 1);
				}
			}

			if (this.basePubSubClient)
			{
				this.basePubSubClient.disconnect();
			}
		},

		async completeAuth()
		{
			if (!this.channelAuth.isAuthed || !this.botAuth.isAuthed)
			{
				return;
			}

			await this.shutdown();

			await this.doAuth();

			await this.setupChatTriggers();

			await this.setupWebHookTriggers();

			await this.setupPubSubTriggers();

			await this.initConditions();

			await this.initChannelRewards();
		},

		async doAuth()
		{
			this.chatAuthProvider = null;//this.channelAuth.createAuthProvider()

			this.channelTwitchClient = new ApiClient({
				authProvider: this.channelAuth,
			});

			this.botTwitchClient = new ApiClient({
				authProvider: this.botAuth
			});

			//Get the IDs
			this.channelId = await (await this.channelTwitchClient.kraken.users.getMe()).id;
			this.botId = await (await this.botTwitchClient.kraken.users.getMe()).id;
		},

		setupSettingsIPC()
		{
			ipcMain.handle('twitchGetAuthStatus', async () =>
			{
				return {
					bot: this.botAuth.isAuthed,
					channel: this.channelAuth.isAuthed,
				}
			})

			ipcMain.handle('twitchDoBotAuth', async () =>
			{
				let result = await this.botAuth.doAuth(true);
				if (result)
				{
					await this.completeAuth();
				}
			})

			ipcMain.handle('twitchDoChannelAuth', async () =>
			{
				let result = await this.channelAuth.doAuth(true);
				if (result)
				{
					await this.completeAuth();
				}
			})
		},

		parseMessage(message)
		{
			let firstSpace = message.indexOf(' ');

			if (firstSpace == -1)
			{
				return { command: message.toLowerCase(), args: [], string: "" }
			}

			let command = message.substr(0, firstSpace).toLowerCase();

			let string = message.substr(firstSpace + 1);

			let args = string.split(' ').filter((arg) => arg.length != 0);

			return { command, args, string };
		},

		async setupChatTriggers()
		{
			this.chatClient = new ChatClient(this.botAuth, { channels: [this.settings.channelName] });
			await this.chatClient.connect();

			this.chatClient.say(this.settings.channelName.toLowerCase(), "StreamMachine is now running.");

			//Setup triggers
			this.chatClient.onMessage(async (channel, user, message, msgInfo) =>
			{
				if (this.colorCache)
					this.colorCache[msgInfo.userInfo.userId] = msgInfo.userInfo.color;

				this.webServices.websocketServer.broadcast(JSON.stringify({
					chat: {
						user,
						color: msgInfo.userInfo.color,
						message,
						emoteOffsets: Object.fromEntries(msgInfo.emoteOffsets)
					}
				}));

				let parsed = this.parseMessage(message);

				const context = {
					name: parsed.command,
					user,
					args: parsed.args,
					argString: parsed.string,
					userColor: msgInfo.userInfo.color,
					message,
					filteredMessage: this.filterMessage(message)
				}

				if (msgInfo.userInfo.isMod || msgInfo.userInfo.isBroadcaster)
				{
					if (this.actions.trigger('modchat', context))
					{
						return;
					}
				}

				if (msgInfo.userInfo.isVip)
				{
					if (this.actions.trigger('vipchat', context))
					{
						return;
					}
				}

				if (msgInfo.userInfo.isSubscriber)
				{
					if (this.actions.trigger('subchat', context))
					{
						return;
					}
				}

				if (this.actions.trigger('chat', context))
				{
					return;
				}

			});

			this.chatClient.onRaid((channel, user, raidInfo) =>
			{
				this.actions.trigger("raid", { number: raidInfo.viewerCount, user: raidInfo.displayName });
			})
		},

		async setupWebHookTriggers()
		{
			this.webhooks = new WebHookListener(this.channelTwitchClient, new ExpressWebhookAdapter({
				hostName: this.webServices.hostname,
				listenerPort: this.webServices.port
			}, "/twitch-hooks"));

			this.webhookRouter = express.Router();

			this.webhooks.applyMiddleware(this.webhookRouter);

			this.webServices.app.use(this.webhookRouter);

			this.followerCache = new Set();

			let followHook = await this.webhooks.subscribeToFollowsToUser(this.channelId, async (follow) =>
			{
				if (this.followerCache.has(follow.userId))
					return;

				this.followerCache.add(follow.userId);

				console.log(`followed by ${follow.userDisplayName}`);
				this.actions.trigger('follow', { user: follow.userDisplayName, ...{ userColor: this.colorCache[follow.userId] } });


				let follows = await this.channelTwitchClient.helix.users.getFollows({ followedUser: this.channelId });
				this.state.followers = follows.total;
				//let follows = await channelTwitchClient.helix.users.getFollows({ followedUser: channelId });
				//variables.set("followers", follows.total);
			});

			let subHook = await this.webhooks.subscribeToStreamChanges(this.channelId, async (stream) =>
			{
				//Stream Changed
				console.log("Stream Changed");

				let game = await stream.getGame();
				console.log("Game Name", game.name);

				this.state.twitchCategory = game.name;
			});

			this.webhookSubs = [followHook, subHook];
		},

		async setupPubSubTriggers()
		{
			this.basePubSubClient = new BasicPubSubClient();
			this.pubSubClient = new PubSubClient(this.basePubSubClient);
			await this.pubSubClient.registerUserListener(this.channelTwitchClient, this.channelId);

			await this.pubSubClient.onBits(this.channelId, (message) =>
			{
				console.log(`Bits: ${message.bits}`);


				this.actions.trigger("bits", {
					number: message.bits,
					user: message.userName,
					message: message.message,
					filteredMessage: this.filterMessage(message.message),
					...{ userColor: this.colorCache[message.userId] }
				});
			});

			await this.pubSubClient.onRedemption(this.channelId, (redemption) =>
			{
				console.log(`Redemption: ${redemption.rewardId} ${redemption.rewardName}`);
				let message = redemption.message;
				if (!message)
				{
					message = "";
				}

				this.actions.trigger("redemption", {
					name: redemption.rewardName,
					message,
					filteredMessage: this.filterMessage(message),
					user: redemption.userDisplayName,
					...{ userColor: this.colorCache[redemption.userId] }
				});
			});

			await this.pubSubClient.onSubscription(this.channelId, async (message) =>
			{
				if (message.isGift)
				{
					console.log(`Gifted sub ${message.gifterDisplayName} -> ${message.userDisplayName}`);
					this.actions.trigger('subscribe', { name: "gift", gifter: message.gifterDisplayName, user: message.userDisplayName, ...{ userColor: this.colorCache[message.userId] } });
				}
				else
				{
					let months = message.months ? message.months : 0;
					console.log(`Sub ${message.userDisplayName} : ${months}`);
					this.actions.trigger('subscribe', { number: months, user: message.userDisplayName, prime: message.subPlan == "Prime", ...{ userColor: this.colorCache[message.userId] } })
				}

				this.state.subscribers = await this.channelTwitchClient.kraken.channels.getChannelSubscriptionCount(this.channelId);
			});
		},

		async initConditions()
		{
			let stream = await this.channelTwitchClient.helix.streams.getStreamByUserId(this.channelId);

			if (stream)
			{
				let game = await stream.getGame();

				this.state.twitchCategory = game.name;
			}

			this.state.subscribers = await this.channelTwitchClient.kraken.channels.getChannelSubscriptionCount(this.channelId);
			let follows = await this.channelTwitchClient.helix.users.getFollows({ followedUser: this.channelId });
			this.state.followers = follows.total;
		},

		async initChannelRewards()
		{
			this.rewardsDefinitions = new HotReloader("./user/rewards.yaml",
				() =>
				{
					this.ensureChannelRewards()
				},
				() => { })
			await this.ensureChannelRewards();
		},

		async ensureChannelRewards()
		{
			let rewards = await this.channelTwitchClient.helix.channelPoints.getCustomRewards(this.channelId, true);

			let handledRewards = new Set();

			for (let reward of rewards)
			{
				if (!(reward.title in this.rewardsDefinitions.data))
				{
					//Not in the file, delete it.
					await this.channelTwitchClient.helix.channelPoints.deleteCustomReward(this.channelId, reward.id);
				}
				else
				{
					//Existing Reward
					handledRewards.add(reward.title)

					let needsUpdate = false;

					let rewardDef = this.rewardsDefinitions.data[reward.title];

					if (reward.prompt != rewardDef.description)
						needsUpdate = true;
					if (reward.cost != rewardDef.cost)
						needsUpdate = true;

					if (reward.userInputRequired != !!rewardDef.inputRequired)
						needsUpdate = true;
					if (reward.autoApproved != !!rewardDef.skipQueue)
						needsUpdate = true;
					if (reward.globalCooldown != rewardDef.cooldown)
						needsUpdate = true;
					if (reward.maxRedemptionsPerStream != rewardDef.maxRedemptionsPerStream)
						needsUpdate = true;
					if (reward.maxRedemptionsPerUserPerStream != rewardDef.maxRedemptionsPerUserPerStream)
						needsUpdate = true;

					if (needsUpdate)
					{
						await this.channelTwitchClient.helix.channelPoints.updateCustomReward(this.channelId, reward.id, {
							prompt: rewardDef.description,
							cost: rewardDef.cost,
							userInputRequired: !!rewardDef.inputRequired,
							autoFulfill: !!rewardDef.skipQueue,
							globalCooldown: rewardDef.cooldown || 0,
							maxRedemptionsPerStream: rewardDef.maxRedemptionsPerStream || null,
							maxRedemptionsPerUserPerStream: rewardDef.maxRedemptionsPerUserPerStream || null,
						})
					}
				}
			}

			//Check for new rewards
			for (let rewardKey in this.rewardsDefinitions.data)
			{
				if (handledRewards.has(rewardKey))
					continue;

				let rewardDef = this.rewardsDefinitions.data[rewardKey];


				//inputRequired: false
				//skipQueue: true
				//Create the new reward.
				try
				{
					await this.channelTwitchClient.helix.channelPoints.createCustomReward(this.channelId, {
						title: rewardKey,
						prompt: rewardDef.description,
						cost: rewardDef.cost,
						userInputRequired: !!rewardDef.inputRequired,
						autoFulfill: !!rewardDef.skipQueue,
						globalCooldown: rewardDef.cooldown || 0,
						maxRedemptionsPerStream: rewardDef.maxRedemptionsPerStream || null,
						maxRedemptionsPerUserPerStream: rewardDef.maxRedemptionsPerUserPerStream || null,
					})
				} catch (err)
				{
					console.log(`Error creating channel reward: ${rewardKey}. Message: ${err}`);
				}
			}
		},

		async switchChannelRewards(activeRewards, inactiveRewards)
		{
			if (!this.channelId)
				return;

			let rewards = await this.channelTwitchClient.helix.channelPoints.getCustomRewards(this.channelId, true);

			for (let reward of rewards)
			{
				if (!reward.isEnabled && activeRewards.has(reward.title))
				{
					await this.channelTwitchClient.helix.channelPoints.updateCustomReward(this.channelId, reward.id, { isPaused: false, isEnabled: true });
				}
				else if (reward.isEnabled && inactiveRewards.has(reward.title))
				{
					await this.channelTwitchClient.helix.channelPoints.updateCustomReward(this.channelId, reward.id, { isPaused: false, isEnabled: false });
				}
			}
		}
	},
	async onProfileLoad(profile, config)
	{
		profile.rewards = config.rewards || [];
	},
	async onProfilesChanged(activeProfiles, inactiveProfiles)
	{
		let activeRewards = new Set();
		let inactiveRewards = new Set();
		//Handle rewards
		for (let activeProf of activeProfiles)
		{
			for (let reward of activeProf.rewards)
			{
				activeRewards.add(reward);
			}
		}

		for (let inactiveProf of inactiveProfiles)
		{
			for (let reward of inactiveProf.rewards)
			{
				inactiveRewards.add(reward);
			}
		}

		//Set all the reward states.
		//Hackily reach inside twitch plugin.
		this.switchChannelRewards(activeRewards, inactiveRewards);
	},
	settings: {
		botName: { type: String },
		channelName: { type: String },
	},
	secrets: {
		apiClientId: { type: String },
		apiClientSecret: { type: String },
	},
	state: {
		twitchCategory: {
			type: String,
			name: "Twitch Category",
			description: "Change profiles based on the stream's twitch category"
		},
		subscribers: {
			type: Number,
			name: "Twitch Subscribers",
		},
		followers: {
			type: Number,
			name: "Twitch Followers"
		}
	},
	triggers: {
		chat: {
			name: "Chat",
			description: "Fires when any user chats.",
			type: "NameAction"
		},
		subchat: {
			name: "Sub Chat",
			description: "Fires for only subscribed user chats",
			type: "NameAction"
		},
		vipchat: {
			name: "VIP Chat",
			description: "Fires for only VIP user chats",
			type: "NameAction"
		},
		modchat: {
			name: "Mod Chat",
			description: "Fires for when a mod or the broadcaster chats",
			type: "NameAction"
		},
		redemption: {
			name: "Channel Points Redemption",
			description: "Fires for when a channel point reward is redeemed",
			type: "NameAction"
		},
		follow: {
			name: "Follow",
			description: "Fires for when a user follows.",
			type: "SingleAction"
		},
		subscribe: {
			name: "Subscription",
			description: "Fires for when a user subscribes.",
			type: "NumberAction"
		},
		bits: {
			name: "Bits",
			description: "Fires for when a user gives bits",
			type: "NumberAction"
		},
		raid: {
			name: "Raid",
			description: "Fires when a raid start",
			type: "NumberAction"
		}
	},
	actions: {
		say: {
			name: "Say",
			description: "Uses the bot to send a twitch chat message",
			data: {
				type: "TemplateString"
			},
			handler(message, context)
			{
				this.chatClient.say(this.settings.channelName.toLowerCase(), template(message, context));
			}
		},
		multiSay: {
			name: "Multi Say",
			description: "Uses the bot to send an array of twitch chat messages",
			data: {
				type: "TemplateString"
			},
			handler(message, context)
			{
				let msgArray = evalTemplate(message, context)
				for (let msg of msgArray)
				{
					this.chatClient.say(this.settings.channelName.toLowerCase(), msg);
				}
			}
		}
	},
	settingsView: 'twitch.vue'
}


