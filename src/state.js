import { writable } from 'svelte/store';

export const progress = writable(0);
export const cubeScreen = writable([]);
export const hoverCube = writable(-1);
export const project = writable(-1);
