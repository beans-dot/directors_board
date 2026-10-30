import type { ButtonHTMLAttributes } from 'react';

export function Button({
  variant = 'line',
  block,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'line' | 'ghost' | 'danger'; block?: boolean }) {
  return <button className={`btn btn-${variant} ${block ? 'btn-block' : ''} ${className}`} {...props} />;
}
