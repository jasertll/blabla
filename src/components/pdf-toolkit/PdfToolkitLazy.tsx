'use client';

/**
 * غلاف كسول لأدوات المستندات.
 *
 * استخدم هذا الغلاف — لا المكوّن مباشرة — في صفحات JOSINT:
 * محرك PDF يزن نحو 330 كيلوبايت، وتحميله كسولاً يعني أن بقية
 * لوحة التحقيق تبقى خفيفة ولا تدفع ثمنه إلا عند فتح التبويب فعلاً.
 *
 *   import PdfToolkit from '@/components/pdf-toolkit/PdfToolkitLazy';
 *   <PdfToolkit />
 */

import dynamic from 'next/dynamic';

const PdfToolkit = dynamic(() => import('./PdfToolkit'), {
  ssr: false,
  loading: () => (
    <div dir="rtl" className="space-y-3">
      <div className="h-20 animate-pulse rounded-xl border border-border bg-surface-elevated" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-surface-elevated" />
        ))}
      </div>
    </div>
  ),
});

export default PdfToolkit;
