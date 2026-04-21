import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold mb-3">Page not found</h1>
        <p className="text-sm text-gray-300 mb-6">
          The page you requested does not exist in this build.
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-2 rounded border border-gray-600 hover:border-gray-400"
        >
          Back to Vessel
        </Link>
      </div>
    </div>
  );
}
