import * as React from 'react'
import { cn } from '@/lib/utils'

export default function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('badge gray', className)} {...props} />
}
