import Vue from 'vue'
import VueRouter from 'vue-router'
import Profiles from "../views/Profiles.vue";
import ProfileEditor from "../views/ProfileEditor.vue";
import Plugin from "../views/Plugin.vue";

Vue.use(VueRouter)

const routes = [
	{
		path: "/",
		name: "Profiles",
		component: Profiles
	},
	{
		path: "/profiles/:profile",
		name: "Profile Editor",
		component: ProfileEditor
	},
	{
		path: "/plugins/:pluginName",
		name: "Plugin Settings",
		component: Plugin
	}
]

const router = new VueRouter({
	routes
})

export default router
