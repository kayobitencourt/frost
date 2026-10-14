import { writable } from 'svelte/store';

export const progress = writable(0);
export const sceneIndex = writable(0);
export const project = writable(-1);
export const domeLabels = writable([]);
export const callouts = writable([]);
export const hoverCrystal = writable(-1);
export const linkIndex = writable(1);
