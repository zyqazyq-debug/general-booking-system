<template>
  <DistributionCreateLinkImpl
    :service-id="queryServiceId"
    :parent-node-id="queryParentNodeId"
    :source-agent-id="querySourceAgentId"
    @back="goBack"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { DistributionCreateLinkImpl } from '@/domains/distribution';

const queryServiceId = ref('');
const queryParentNodeId = ref('');
const querySourceAgentId = ref('');

onLoad((options: any) => {
    queryServiceId.value = options.service_id || '';
    queryParentNodeId.value = options.parent_node_id || '';
    querySourceAgentId.value = options.source_agent_id || '';
});

const goBack = () => {
    const pages = getCurrentPages();
    if (pages.length > 1) {
        uni.navigateBack();
    } else {
        uni.reLaunch({ url: '/pages/index/index' });
    }
};
</script>
