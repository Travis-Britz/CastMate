<template>
  <trigger-table
    :trigger="trigger"
    :triggerKey="triggerKey"
    :value="value"
    @input="(v) => $emit('input', v)"
  >
    <template v-slot:label="labelProps">
      {{ labelProps.item.key }}
    </template>
    <template v-slot:selector="selectProps">
      <v-text-field
        :value="selectProps.value"
        @input="selectProps.valueInput"
        :label="trigger.triggerUnit || 'Command'"
        single-line
      ></v-text-field>
    </template>
    <template v-slot:new-selector="selectProps">
      <v-text-field
        :value="selectProps.value"
        @input="selectProps.valueInput"
        :label="selectProps.label"
        single-line
      />
    </template>
  </trigger-table>
</template>

<script>
import TriggerTable from "./TriggerTable.vue";

export default {
  components: { TriggerTable },
  props: {
    trigger: {},
    triggerKey: { type: String },
    value: {},
  },
};
/*
 
*/
</script>

<style>
</style>