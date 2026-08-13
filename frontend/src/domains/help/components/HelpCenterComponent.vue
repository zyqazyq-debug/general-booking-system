<template>
  <scroll-view scroll-y class="help-scroll-view">
    <view class="help-center-comp">
      <view class="hero-card">
        <text class="hero-title">通用预约系统是什么？</text>
        <text class="hero-desc">
          这是一个围绕“时间预约”设计的平台：你可以发布自己的服务时间，也可以收藏并分享他人的服务，促成预约。
        </text>
      </view>

      <AppCard title="核心功能">
        <view class="item-row">
          <text class="item-title">发布服务</text>
          <text class="item-desc">设置服务标题、时长、价格与可预约时间段，面向用户开放预约。</text>
        </view>
        <view class="item-row">
          <text class="item-title">收藏与分享</text>
          <text class="item-desc">收藏别人的服务后可设置展示价格，生成自己的分享链接。</text>
        </view>
        <view class="item-row">
          <text class="item-title">预约消费</text>
          <text class="item-desc">用户可按日期与时段下单预约，系统自动校验时段可用性。</text>
        </view>
      </AppCard>

      <AppCard title="额度与费用">
        <view class="item-row">
          <text class="item-title">免费额度</text>
          <text class="item-desc">默认可上架收藏 20 条；达到上限后需下架或扩容。</text>
        </view>
        <view class="item-row">
          <text class="item-title">扩容规则</text>
          <text class="item-desc">可按月扩容上架额度，当前规则为每月每增加 1 条 = 1 元。</text>
        </view>
      </AppCard>

      <AppCard title="信用点机制">
        <view class="item-row">
          <text class="item-title">下单冻结</text>
          <text class="item-desc">部分预约会冻结信用点作为履约保障，订单结束后按规则解冻或扣减。</text>
        </view>
        <view class="item-row">
          <text class="item-title">信用不足</text>
          <text class="item-desc">信用点不足时无法完成对应预约，可在个人中心查看并补充。</text>
        </view>
      </AppCard>

      <AppCard title="分享回馈">
        <view class="item-row">
          <text class="item-title">回馈来源</text>
          <text class="item-desc">邀请用户使用系统后，你可按规则获得软件使用费回馈。</text>
        </view>
        <view class="item-row">
          <text class="item-title">明细查询</text>
          <text class="item-desc">可在“个人中心 → 分享回馈”查看累计回馈与每笔明细。</text>
        </view>
      </AppCard>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import AppCard from '@/components/AppCard.vue';
</script>

<style scoped>
.help-scroll-view {
  height: 100%;
  width: 100%;
}

.help-center-comp {
  padding: 16px;
  padding-bottom: 40px; /* Extra padding for bottom space */
}

.hero-card {
  background: linear-gradient(135deg, #4e97fc 0%, #6366f1 100%);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 16px;
}
.hero-title {
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 8px;
  display: block;
}
.hero-desc {
  color: #e2e8f0;
  font-size: 13px;
  line-height: 1.65;
  display: block;
}

.item-row {
  margin-bottom: 10px;
}
.item-row:last-child {
  margin-bottom: 0;
}
.item-title {
  color: #334155;
  font-size: 13px;
  font-weight: 600;
  display: block;
  margin-bottom: 4px;
}
.item-desc {
  color: #64748b;
  font-size: 12px;
  line-height: 1.65;
  display: block;
}
</style>
