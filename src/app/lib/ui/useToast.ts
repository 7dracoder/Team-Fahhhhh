"use client";

import { useSyncExternalStore } from "react";

export type ToastType = "info" | "success" | "error";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
}

type Listener = () => void;

const listeners: Set<Listener> = new Set();
let toasts: Toast[] = [];

function emit() {
  // Replace the array reference so useSyncExternalStore detects the change.
  toasts = toasts.slice();
  for (const l of listeners) l();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): Toast[] {
  return toasts;
}

const EMPTY: Toast[] = [];
function getServerSnapshot(): Toast[] {
  return EMPTY;
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function dismissToast(id: string): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

function makeId(): string {
  // Cheap monotonically-unique id; doesn't need crypto.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toast(message: string, type: ToastType = "info"): string {
  const id = makeId();
  toasts = [...toasts, { id, message, type, createdAt: Date.now() }];
  emit();
  return id;
}
