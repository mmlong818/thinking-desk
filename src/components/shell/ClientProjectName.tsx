'use client';

import { useEffect, useState } from 'react';
import { listLocalProjects } from '@/lib/client-projects';

interface Props {
  slug: string;
  fallback: string;
}

/** 服务端渲染时拿不到 localStorage，先用 fallback；hydrate 后用真实名称覆盖。 */
export function ClientProjectName({ slug, fallback }: Props) {
  const [name, setName] = useState(fallback);
  useEffect(() => {
    try {
      const decoded = decodeURIComponent(slug);
      const list = listLocalProjects();
      const hit = list.find((p) => p.slug === slug || p.slug === decoded);
      if (hit?.name) setName(hit.name);
    } catch {
      // ignore
    }
  }, [slug]);
  return <>{name}</>;
}
