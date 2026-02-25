import { request } from '@/utils/request';

// Generate a share link
export const generateShareLink = (data: { 
    target_type: 'SINGLE' | 'COLLECTION' | 'BATCH', 
    target_id?: string,
    targetIds?: string[]
}) => {
    return request({
        url: '/share-link/generate',
        method: 'POST',
        data: {
            targetType: data.target_type,
            targetId: data.target_id,
            targetIds: data.targetIds
        }
    });
};

// Resolve a share link token
export const resolveShareLink = (token: string) => {
    return request({
        url: '/share-link/resolve',
        method: 'GET',
        data: { token }
    });
};
