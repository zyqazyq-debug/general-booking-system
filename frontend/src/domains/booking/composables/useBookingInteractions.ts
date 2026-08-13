import { type Ref } from 'vue';

export function useBookingInteractions(service: Ref<any>) {
  const openLocation = () => {
    if (!service.value?.location) return;
    const { latitude, longitude, name, address } = service.value.location;
    if (latitude && longitude) {
      uni.openLocation({
        latitude,
        longitude,
        name,
        address,
        scale: 18,
      });
      return;
    }
    uni.showToast({ title: '位置信息不完整', icon: 'none' });
  };

  return {
    openLocation,
  };
}
