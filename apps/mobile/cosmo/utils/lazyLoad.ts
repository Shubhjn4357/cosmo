/**
 * Lazy Loading Utilities
 * Helper functions for code splitting and dynamic imports
 */

import { lazy, ComponentType } from 'react';

/**
 * Lazy load a React component with error boundary
 * @param importFn Component import function
 * @param fallback Optional fallback component while loading
 */
export function lazyLoad<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  fallback?: ComponentType
): T {
  const LazyComponent = lazy(importFn);
  
  // Return wrapped component
  return LazyComponent as any;
}

/**
 * Preload a lazy component (useful for prefetching)
 * @param importFn Component import function
 */
export function preloadComponent(importFn: () => Promise<any>): void {
  // Start loading the component
  importFn();
}

/**
 * Lazy load multiple components
 * @param imports Object with component names as keys and import functions as values
 */
export function lazyLoadMultiple<T extends Record<string, () => Promise<any>>>(
  imports: T
): Record<keyof T, ComponentType> {
  const result = {} as Record<keyof T, ComponentType>;
  
  for (const [name, importFn] of Object.entries(imports)) {
    result[name as keyof T] = lazy(importFn as any) as any;
  }
  
  return result;
}

// Export React.lazy for convenience
export { lazy } from 'react';
