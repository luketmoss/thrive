import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { ThriveLogo } from './thrive-logo';

describe('ThriveLogo — AC2: inline SVG component', () => {
  it('renders an inline <svg> element, not an <img>', () => {
    const { container } = render(<ThriveLogo />);
    const svg = container.querySelector('svg');
    const img = container.querySelector('img');
    expect(svg).toBeTruthy();
    expect(img).toBeNull();
  });

  it('has aria-hidden="true" for decorative use', () => {
    const { container } = render(<ThriveLogo />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('defaults to size 24', () => {
    const { container } = render(<ThriveLogo />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('accepts a custom size prop', () => {
    const { container } = render(<ThriveLogo size={64} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('64');
    expect(svg?.getAttribute('height')).toBe('64');
  });

  it('uses var(--color-accent) for hexagon fill', () => {
    const { container } = render(<ThriveLogo />);
    const polygon = container.querySelector('polygon');
    expect(polygon?.getAttribute('fill')).toBe('var(--color-accent)');
  });

  it('contains a hexagon polygon', () => {
    const { container } = render(<ThriveLogo />);
    const polygon = container.querySelector('polygon');
    expect(polygon).toBeTruthy();
    expect(polygon?.getAttribute('points')).toContain('128');
  });

  it('passes class prop through to the svg element', () => {
    const { container } = render(<ThriveLogo class="login-icon" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('login-icon')).toBe(true);
  });
});
