'use client';

import { useCallback, useState } from 'react';

// A node's stage = an action in flight, else a view the person stepped back to ("← 回上一步",
// "重新粘贴"), else what the items say. Actions clear the manual view when they finish.

export interface NodeStage<S extends string> {
  stage: S;
  setView: (view: S | null) => void;
}

export function useNodeStage<S extends string>(derived: S, busy: S | null = null): NodeStage<S> {
  const [view, setViewState] = useState<S | null>(null);
  const setView = useCallback((v: S | null) => setViewState(v), []);
  return { stage: busy ?? view ?? derived, setView };
}
