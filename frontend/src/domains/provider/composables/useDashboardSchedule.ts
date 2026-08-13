import { ref, computed, watch } from 'vue';
import dayjs from 'dayjs';
import { getOrders } from '@/domains/order';

export function useDashboardSchedule() {
    const viewMode = ref<'week' | 'day'>('day');
    const selectedDate = ref(dayjs().format('YYYY-MM-DD'));
    
    // Store loaded orders
    const loadedOrders = ref<any[]>([]);
    
    // Cache range to avoid redundant fetches
    const loadedRange = ref({
        start: '',
        end: ''
    });

    const orderStats = ref({
        today_count: 0,
        today_income: 0,
        pending_count: 0
    });
    let currentEnsurePromise: Promise<void> | null = null;
    let queuedForceReload = false;

    // Compute view data from loadedOrders
    const weeklyOrders = computed(() => {
        const start = dayjs(selectedDate.value).startOf('week');
        const end = dayjs(selectedDate.value).endOf('week');
        return loadedOrders.value.filter((o: any) => {
             const t = dayjs(o.start_time);
             return (t.isAfter(start) || t.isSame(start)) && (t.isBefore(end) || t.isSame(end));
        });
    });

    const todaysOrders = computed(() => {
        const start = dayjs(selectedDate.value).startOf('day');
        const end = dayjs(selectedDate.value).endOf('day');
        return loadedOrders.value.filter((o: any) => {
             const t = dayjs(o.start_time);
             return (t.isAfter(start) || t.isSame(start)) && (t.isBefore(end) || t.isSame(end));
        }).sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    });

    const fetchOrders = async (rangeStart: string, rangeEnd: string) => {
        try {
            const res: any = await getOrders({
                role: 'owner',
                start_time: rangeStart,
                end_time: rangeEnd,
                limit: 500
            });
            
            if (Array.isArray(res)) {
                // Merge strategy: remove old within range, add new
                // Or simple replacement if ranges are disjoint?
                // For simplicity: We maintain a single list. 
                // Since backend filters by start_time, we should merge carefully.
                // Let's just append new ones and dedup by ID.
                
                const newOrders = res.filter((o: any) => o.status !== 'CANCELLED');
                const existingIds = new Set(loadedOrders.value.map(o => o.id));
                
                const uniqueNew = newOrders.filter((o: any) => !existingIds.has(o.id));
                loadedOrders.value = [...loadedOrders.value, ...uniqueNew];
            }
        } catch (e) {
            console.error('Load orders failed', e);
        }
    };

    const ensureDataLoaded = async (force = false) => {
        if (currentEnsurePromise) {
            if (force) queuedForceReload = true;
            await currentEnsurePromise;
            if (queuedForceReload) {
                queuedForceReload = false;
                return ensureDataLoaded(true);
            }
            return;
        }
        const current = dayjs(selectedDate.value);
        
        // Desired buffer: Current - 1 Month to Current + 3 Months
        const desiredStart = current.subtract(1, 'month').startOf('month');
        const desiredEnd = current.add(3, 'month').endOf('month');
        
        const loadedStart = loadedRange.value.start ? dayjs(loadedRange.value.start) : null;
        const loadedEnd = loadedRange.value.end ? dayjs(loadedRange.value.end) : null;

        // Check if current date is comfortably within loaded range
        // If loaded range is empty OR current date is outside OR close to edge (e.g. within 1 week of edge)
        // Then reload.
        
        let needFetch = force;
        let fetchStart = desiredStart;
        let fetchEnd = desiredEnd;

        if (!loadedStart || !loadedEnd) {
            needFetch = true;
        } else {
            // If current is before loadedStart or after loadedEnd
            if (current.isBefore(loadedStart) || current.isAfter(loadedEnd)) {
                 needFetch = true;
            } else {
                 // Check edges? Optional. For now, strict range check is fine.
                 // Actually, if we just moved a bit, we might still be in range.
                 // But we want to ensure buffer.
                 // Simplest logic: If desired range is NOT fully covered by loaded range?
                 // That might trigger too many fetches.
                 // Better: If selectedDate is NOT within [loadedStart + buffer, loadedEnd - buffer]
                 // Buffer = 7 days.
                 const innerStart = loadedStart.add(7, 'day');
                 const innerEnd = loadedEnd.subtract(7, 'day');
                 
                 if (current.isBefore(innerStart) || current.isAfter(innerEnd)) {
                     // We are close to edge, expand range.
                     // To avoid small fetches, we fetch the full desired window centered on new date.
                     needFetch = true;
                     // But we don't want to re-fetch what we have.
                     // Complex merging is hard. 
                     // Simple approach: Just fetch the new desired window and merge/dedup.
                     // The backend query is cheap enough for this volume.
                 }
            }
        }

        if (!needFetch) return;

        currentEnsurePromise = (async () => {
            try {
                await fetchOrders(fetchStart.toISOString(), fetchEnd.toISOString());
                if (!loadedStart || fetchStart.isBefore(loadedStart)) loadedRange.value.start = fetchStart.toISOString();
                if (!loadedEnd || fetchEnd.isAfter(loadedEnd)) loadedRange.value.end = fetchEnd.toISOString();
            } finally {
                currentEnsurePromise = null;
            }
        })();
        await currentEnsurePromise;
    };
    
    const loadStats = async () => {
        // ... (existing logic or placeholder)
    };

    const toggleViewMode = () => {
        viewMode.value = viewMode.value === 'week' ? 'day' : 'week';
    };

    const onDateChange = (e: any) => {
        selectedDate.value = e.detail.value;
    };

    const onPrevWeek = () => {
        selectedDate.value = dayjs(selectedDate.value).subtract(1, 'week').format('YYYY-MM-DD');
    };

    const onNextWeek = () => {
        selectedDate.value = dayjs(selectedDate.value).add(1, 'week').format('YYYY-MM-DD');
    };

    const onPrevDay = () => {
        selectedDate.value = dayjs(selectedDate.value).subtract(1, 'day').format('YYYY-MM-DD');
    };

    const onNextDay = () => {
        selectedDate.value = dayjs(selectedDate.value).add(1, 'day').format('YYYY-MM-DD');
    };

    // Initialize
    watch(selectedDate, () => {
        ensureDataLoaded();
    }, { immediate: true });

    return {
        viewMode,
        selectedDate,
        weeklyOrders,
        todaysOrders,
        orderStats,
        loadWeeklyOrders: ensureDataLoaded, // Alias for compatibility/init
        loadTodaysOrders: ensureDataLoaded, // Alias
        loadStats,
        toggleViewMode,
        onDateChange,
        onPrevWeek,
        onNextWeek,
        onPrevDay,
        onNextDay
    };
}
