/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @lookout/core is shipped as TypeScript source from the workspace
  transpilePackages: ['@lookout/core'],
};
export default nextConfig;
