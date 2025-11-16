/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  // Performance optimizations
  swcMinify: true,

  // Experimental optimizations for faster builds
  experimental: {
    // Optimize package imports
    optimizePackageImports: ['@reduxjs/toolkit', 'axios'],
  },

  // Disable source maps in development for faster builds
  productionBrowserSourceMaps: false,

  // Optimize images
  images: {
    domains: ['localhost', 'lh3.googleusercontent.com'],
    formats: ['image/avif', 'image/webp'],
  },

  // Disable webpack build indicator
  devIndicators: {
    buildActivity: false,
    appIsrStatus: false,
  },

  // Skip type checking during build (we'll do it separately if needed)
  typescript: {
    ignoreBuildErrors: false,
  },

  // Skip ESLint during builds
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Optimize for WSL2 filesystem
  onDemandEntries: {
    // Period (in ms) where the server will keep pages in the buffer
    maxInactiveAge: 60 * 1000,
    // Number of pages that should be kept simultaneously without being disposed
    pagesBufferLength: 2,
  },
}

module.exports = nextConfig


