function removeItem(array: any[], index: number): any[] {
    return [...array.slice(0, index), ...array.slice(index + 1)];
}

export default {
    findAndRemove: <T>(array: T[], item: T): T[] => {
        const index = array.indexOf(item);
        return index >= 0 ? removeItem(array, index) : array;
    },
    insert: <T>(array: T[], index: number, item: T): T[] => {
        return [...array.slice(0, index), item, ...array.slice(index)];
    },
    remove: <T>(array: T[], index: number): T[] => removeItem(array, index),
    replace: <T>(array: T[], index: number, item: T): T[] => {
        return index === array.length - 1
            ? [...array.slice(0, index), item]
            : [...array.slice(0, index), item, ...array.slice(index + 1)];
    }
};