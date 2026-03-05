import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          map: ['maplibre-gl'],
          three: ['three', 'three/examples/jsm/loaders/GLTFLoader.js', 'satellite.js'],
          media: ['hls.js'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api/opensky': {
        target: 'https://opensky-network.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/opensky/, '/api'),
      },
      '/api/celestrak': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/celestrak/, ''),
      },
      '/api/earth-search': {
        target: 'https://earth-search.aws.element84.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/earth-search/, ''),
      },
      '/api/marineais': {
        target: 'https://oceans6dev.arcgis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/marineais/, ''),
      },
      '/api/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass/, '/api'),
      },
      '/api/ontario511': {
        target: 'https://511on.ca',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ontario511/, ''),
      },
      '/api/caltrans': {
        target: 'https://caltrans-gis.dot.ca.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/caltrans/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
  },
})
