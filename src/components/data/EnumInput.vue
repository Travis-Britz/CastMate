<template>
  <v-combobox
    v-if="isAutocomplete"
    :value="value"
    :items="enumItems"
    :loading="loading"
    :label="label"
    :search-input.sync="search"
    @input="(v) => $emit('input', v)"
    @change="(v) => $emit('change', v)"
    @focus="fetchItems"
    :clearable="clearable"
  />
  <v-select
    v-else
    :items="this.enum"
    :label="label"
    dense
    :value="value"
    @input="(v) => $emit('input', v)"
    @change="(v) => $emit('change', v)"
  />
</template>

<script>
import { ipcRenderer } from "electron";
export default {
  props: {
    value: {},
    enum: {},
    queryMode: { type: Boolean, default: () => false },
    label: { type: String },
    clearable: { type: Boolean, default: () => false },
    context: {},
  },
  computed: {
    isAutocomplete() {
      return typeof this.enum == "string" || this.enum instanceof String;
    },
  },
  data() {
    return {
      search: "",
      allItems: [],
      enumItems: [],
      loading: false,
    };
  },
  methods: {
    filterArray(search, arr) {
      return search
        ? arr.filter((i) => i.toLowerCase().includes(search.toLowerCase()))
        : arr;
    },
    async fetchItems() {
      if (this.isAutocomplete && !this.queryMode) {
        this.loading = true;

        const items = await ipcRenderer.invoke(this.enum, this.context);

        this.allItems = items;
        this.enumItems = items;

        this.loading = false;
      }
    },
  },
  watch: {
    async search(newValue) {
      if (this.loading) return;

      this.loading = true;
      if (this.isAutocomplete) {
        this.enumItems = this.filterArray(newValue, this.allItems);
      } else {
        const items = await ipcRenderer.invoke(
          this.enum,
          newValue,
          this.context
        );
        this.enumItems = items;
      }
      this.loading = false;
    },
  },
  async mounted() {
    await this.fetchItems();
  },
};
</script>

<style>
</style>