export const isWechat = () => {
    return /MicroMessenger/i.test(navigator.userAgent);
};

export const isMobile = () => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

export const getSystemInfo = () => {
    try {
        return uni.getSystemInfoSync();
    } catch {
        return null;
    }
};

export const getDeviceInfo = () => {
    try {
        return uni.getSystemInfoSync();
    } catch {
        return {};
    }
};
