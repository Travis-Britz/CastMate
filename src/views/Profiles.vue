<template>
  <v-container fluid>
    <v-card class="linktable-card"  color="grey darken-2">
      <v-card-title>
        <v-text-field
          v-model="search"
          append-icon="mdi-magnify"
          label="Filter"
          single-line
          hide-details
        />
      </v-card-title>
      <v-data-table
        :headers="profileHeaders"
        :items="profiles"
        :search="search"
        @click:row="(item) => $router.push(`/profiles/${item.name}`)"
      >
        <template v-slot:item.actions="{ item }">
          <!--v-btn
            fab
            small
            class="mx-1"
            as="router-link"
            :to="`/profiles/${item.name}`"
          >
            <v-icon small> mdi-pencil </v-icon>
          </v-btn-->
          <v-btn fab small class="mx-1" @click.stop="tryDelete(item.name)">
            <v-icon small> mdi-delete </v-icon>
          </v-btn>
          <v-btn fab small class="mx-1" @click.stop="tryDuplicate(item.name)">
            <v-icon small> mdi-content-copy </v-icon>
          </v-btn>
          <v-btn fab small class="mx-1" @click.stop="tryRename(item.name)">
            <v-icon small> mdi-pencil </v-icon>
          </v-btn>
        </template>

        <template v-slot:footer.prepend>
          <v-btn @click="$refs.addProfileModal.open()"> Add Profile </v-btn>
        </template>
      </v-data-table>
      <named-item-modal
        ref="addProfileModal"
        header="Create New Profile"
        label="Profile Name"
        @created="createNewProfile"
      />
      <named-item-confirmation ref="duplicateDlg" />
      <confirm-dialog ref="deleteDlg" />
    </v-card>
  </v-container>
</template>

<script>
import fs from "fs";
import path from "path";
import YAML from "yaml";
import { mapGetters } from "vuex";
import ConfirmDialog from "../components/dialogs/ConfirmDialog.vue";
import NamedItemModal from "../components/dialogs/NamedItemModal.vue";
import NamedItemConfirmation from "../components/dialogs/NamedItemConfirmation.vue";
export default {
  components: {
    NamedItemModal,
    ConfirmDialog,
    NamedItemConfirmation
  },
  computed: {
    ...mapGetters("ipc", ["paths"]),
    profileHeaders() {
      return [
        { text: "Profile Name", value: "name" },
        { text: "", value: "actions", sortable: false, align: "right" },
      ];
    },
  },
  data() {
    return {
      profiles: [],
      search: "",
    };
  },
  methods: {
    async getFiles() {
      let profiles = await fs.promises.readdir(
        path.join(this.paths.userFolder, "profiles")
      );

      profiles = profiles.filter((f) => path.extname(f) == ".yaml");

      this.profiles = profiles.map((f) => ({
        name: path.basename(f, ".yaml"),
      }));
    },
    async createNewProfile(name) {
      let newYaml = YAML.stringify({
        version: "1.0",
        triggers: {},
        variables: {},
        rewards: [],
      });

      await fs.promises.writeFile(
        path.join(this.paths.userFolder, `profiles/${name}.yaml`),
        newYaml,
        "utf-8"
      );

      this.trackAnalytic("newProfile", { name });

      await this.getFiles();

      this.$router.push(`/profiles/${name}`);
    },
    async tryDelete(name) {
      if (
        await this.$refs.deleteDlg.open(
          "Confirm",
          `Are you sure you want to delete ${name}?`
        )
      ) {
        const filePath = path.join(
          this.paths.userFolder,
          "profiles",
          name + ".yaml"
        );

        if (!fs.existsSync(filePath)) {
          return;
        }

        await fs.promises.unlink(filePath);

        this.trackAnalytic("deleteProfile", { name });

        const idx = this.profiles.findIndex((af) => af.name == name);

        if (idx != -1) {
          this.profiles.splice(idx, 1);
        }
      }
    },
    async tryDuplicate(name) {
      if (await this.$refs.duplicateDlg.open(`Duplicate ${name}?`, `New Profile Name`, "Duplicate", "Cancel"))
      {
        const filePath = path.join(
          this.paths.userFolder,
          "profiles",
          name + ".yaml"
        );

        const newName = this.$refs.duplicateDlg.name

        const destPath = path.join(this.paths.userFolder,
          "profiles",
          newName + ".yaml")

        if (!fs.existsSync(filePath)) {
          return;
        }

        this.trackAnalytic("duplicateProfile", { name });

        await fs.promises.copyFile(filePath, destPath);

        this.$router.push(`/profiles/${newName}`);
      }
    },
    async tryRename(name) {
      if (await this.$refs.duplicateDlg.open(`Rename ${name}?`, `New Profile Name`, "Rename", "Cancel"))
      {
        const filePath = path.join(
          this.paths.userFolder,
          "profiles",
          name + ".yaml"
        );

        const newName = this.$refs.duplicateDlg.name

        const newPath = path.join(this.paths.userFolder,
          "profiles",
          newName + ".yaml")

        if (!fs.existsSync(filePath)) {
          return;
        }

        await fs.promises.rename(filePath, newPath);

        await this.getFiles();
      }
    }
  },
  async mounted() {
    await this.getFiles();
  },
};
</script>

<style>
.el-table__empty-block {
  display: none !important;
}

/* This is for documentation purposes and will not be needed in your application */
#lateral .v-btn--example {
  bottom: 0;
  left: 0;
  position: absolute;
  margin: 0 0 16px 16px;
}

.fab-label {
  position: absolute;
  right: 50px;
  background-color: rgba(0, 0, 0, 0.5);
  padding: 10px;
  box-shadow: 0px 3px 5px -1px rgba(0, 0, 0, 0.2),
    0px 6px 10px 0px rgba(0, 0, 0, 0.14), 0px 1px 18px 0px rgba(0, 0, 0, 0.12);
  border-radius: 2px;
}
</style>