import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { loadThemeChoice, resolveTheme, themeStylesheet } from './lib/themes.ts';

// Theme variables, and the saved theme applied before the first paint (no flash).
const style = document.createElement('style');
style.textContent = themeStylesheet();
document.head.append(style);
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset['theme'] = resolveTheme(loadThemeChoice(), prefersDark).id;

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app mount point');

export default mount(App, { target });
