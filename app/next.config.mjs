/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @lookout/core and @lookout/client are shipped as TypeScript source from the workspace
  transpilePackages: ['@lookout/core', '@lookout/client', '@lookout/worldid'],
};
export default nextConfig;
