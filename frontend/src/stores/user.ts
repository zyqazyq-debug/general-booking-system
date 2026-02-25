import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useUserStore = defineStore('user', () => {
  const userInfo = ref<any>(null);
  const token = ref<string>('');
  const currentRole = ref<string>('CONSUMER');

  const availableRoles = computed(() => {
      return userInfo.value?.roles || ['CONSUMER'];
  });

  const login = (user: any, accessToken: string) => {
    userInfo.value = user;
    token.value = accessToken; 
    currentRole.value = user.roles?.[0] || 'CONSUMER';
    uni.setStorageSync('userInfo', user);
    uni.setStorageSync('token', accessToken);
  };

  const logout = () => {
    userInfo.value = null;
    token.value = '';
    currentRole.value = 'CONSUMER';
    uni.removeStorageSync('userInfo');
    uni.removeStorageSync('token');
  };
  
  const setRole = (role: string) => {
      if (userInfo.value?.roles.includes(role)) {
          currentRole.value = role;
      }
  };

  const saved = uni.getStorageSync('userInfo');
  if (saved) {
      userInfo.value = saved;
      currentRole.value = saved.roles?.[0] || 'CONSUMER';
  }
  
  const savedToken = uni.getStorageSync('token');
  if (savedToken) token.value = savedToken;

  return { userInfo, token, currentRole, availableRoles, login, logout, setRole };
});
