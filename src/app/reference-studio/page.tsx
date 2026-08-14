import type { Metadata } from 'next';

import { ReferenceStudioWindow } from '@/components/reference/ReferenceStudioWindow';

export const metadata: Metadata = {
  title: 'Reference Studio · Vessel',
};

export default function ReferenceStudioPage() {
  return <ReferenceStudioWindow />;
}
