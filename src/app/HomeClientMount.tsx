'use client';

import React from 'react';
import HomeClient from './HomeClient';

export default function HomeClientMount() {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return <HomeClient />;
}
