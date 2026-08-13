import { computed } from 'vue';
import { useUserStore } from '@/shared/stores/user';

export function useReferralPromotionLink() {
  const userStore = useUserStore();

  const promotionLink = computed(() => {
    const referralCode = String(userStore.userInfo?.referral_code || '').trim().toUpperCase();

    if (referralCode && typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/${referralCode}`;
    }

    const query = referralCode
      ? `?ref=${encodeURIComponent(referralCode)}`
      : userStore.userInfo?.id
        ? `?referrer_id=${encodeURIComponent(String(userStore.userInfo.id))}`
        : '';

    const promotionPath = '/pages/login/register';
    let fullUrl = `${promotionPath}${query}`;
    if (typeof window !== 'undefined' && window.location?.origin) {
      fullUrl = `${window.location.origin}/#${promotionPath}${query}`;
    }
    return fullUrl;
  });

  return {
    promotionLink,
  };
}
