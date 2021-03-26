const { ActionQueue } = require("./actions/action-queue.js");
const { ProfileManager } = require("./actions/profile-manager.js");
const HotReloader = require('./utils/hot-reloader.js');
const { createWebServices } = require("./utils/webserver.js");
const { PluginManager } = require("./utils/plugin-manager.js");
const { ipcMain } = require("electron");


async function initInternal()
{
	let plugins = new PluginManager();
	await plugins.load();

	const settings = new HotReloader("./user/settings.yaml",
		(newSettings, oldSettings) =>
		{
			for (let plugin of plugins.plugins)
			{
				plugin.updateSettings(newSettings, oldSettings);
			}
		},
		(err) =>
		{
			console.error("Error loading settings", err);
		});

	const secrets = new HotReloader("./user/secrets/secrets.yaml",
		(newSecrets, oldSecrets) =>
		{
			//TODO handle hotreload.
			for (let plugin of plugins.plugins)
			{
				plugin.updateSecrets(newSecrets, oldSecrets);
			}
		},
		(err) =>
		{
			console.error("Error loading secrets", err);
		});

	const actions = new ActionQueue(plugins);

	const webServices = createWebServices(settings.data.web || {}, secrets.data.web || {}, plugins);

	plugins.webServices = webServices;

	plugins.setupWebsocketReactivity();

	const profiles = new ProfileManager(actions, plugins);

	//Let loose the web server
	webServices.start();

	await plugins.init(settings, secrets, actions, profiles, webServices);

	await profiles.load();

	webServices.startWebsockets();
}

export async function initCastMate()
{
	let initPromise = initInternal();

	ipcMain.handle('waitForInit', async () =>
	{
		return await initPromise;
	})

	await initPromise;
}

