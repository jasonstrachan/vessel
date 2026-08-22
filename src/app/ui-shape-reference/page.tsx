import type { Metadata } from 'next';

import { UiShapeReferenceBoard } from '@/components/ui-shape/UiShapeReferenceBoard';

export const metadata: Metadata = {
  title: 'UI Shape Reference · Vessel',
};

export default function UiShapeReferencePage() {
  return <UiShapeReferenceBoard />;
}
