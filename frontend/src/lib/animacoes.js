import { useEffect, useRef } from 'react';
import gsap from 'gsap';

/**
 * Entrada editorial padrão: elementos com [data-revelar] sobem e aparecem
 * em cascata quando o contêiner monta. Uso: const ref = useRevelar(); <div ref={ref}>…
 */
export function useRevelar(dependencias = []) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    const alvos = ref.current.querySelectorAll('[data-revelar]');
    if (alvos.length === 0) return undefined;
    const animacao = gsap.fromTo(
      alvos,
      { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: 0.7, stagger: 0.07, ease: 'power3.out', clearProps: 'transform' }
    );
    return () => animacao.kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencias);

  return ref;
}
