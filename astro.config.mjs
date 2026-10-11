import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Project site: https://jaime-sql.github.io/wedding-rsvp/
export default defineConfig({
  site: 'https://jaime-sql.github.io',
  base: '/wedding-rsvp',
  trailingSlash: 'ignore',
  vite: {
    plugins: [tailwindcss()],
  },
});
