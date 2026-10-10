import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Primitivas do design system — todas as telas montam a partir daqui.
// ---------------------------------------------------------------------------

export function Botao({ variante = 'primario', className = '', carregando = false, children, ...props }) {
  const estilos = {
    primario: 'bg-bronze text-grafite-950 hover:bg-bronze-claro font-medium',
    fantasma: 'bg-vidro border border-linha text-osso hover:bg-vidro-forte hover:border-linha-forte',
    perigo: 'bg-transparent border border-estado-erro/30 text-estado-erro hover:bg-estado-erro/10',
    sutil: 'bg-transparent text-osso-suave hover:text-osso',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-campo px-4 py-2.5 text-sm
        transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none ${estilos[variante]} ${className}`}
      disabled={carregando || props.disabled}
      {...props}
    >
      {carregando && (
        <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
      )}
      {children}
    </button>
  );
}

export function Campo({ rotulo, dica, ...props }) {
  return (
    <label className="block space-y-1.5">
      {rotulo && <span className="etiqueta">{rotulo}</span>}
      <input className="campo" {...props} />
      {dica && <span className="block text-xs text-osso-mudo">{dica}</span>}
    </label>
  );
}

export function AreaTexto({ rotulo, dica, ...props }) {
  return (
    <label className="block space-y-1.5">
      {rotulo && <span className="etiqueta">{rotulo}</span>}
      <textarea className="campo min-h-[110px] resize-y" {...props} />
      {dica && <span className="block text-xs text-osso-mudo">{dica}</span>}
    </label>
  );
}

export function Selecao({ rotulo, opcoes, ...props }) {
  return (
    <label className="block space-y-1.5">
      {rotulo && <span className="etiqueta">{rotulo}</span>}
      <select className="campo appearance-none cursor-pointer" {...props}>
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor} className="bg-grafite-900">
            {opcao.texto}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Alternador({ rotulo, ativo, aoMudar }) {
  return (
    <button
      type="button"
      onClick={() => aoMudar(!ativo)}
      className="flex items-center gap-3 text-sm text-osso-suave hover:text-osso transition-colors"
    >
      <span
        className={`relative h-5 w-9 rounded-full transition-colors duration-200 ${
          ativo ? 'bg-bronze' : 'bg-grafite-700'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-grafite-950 transition-transform duration-200 ${
            ativo ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      {rotulo}
    </button>
  );
}

const TONS_BADGE = {
  ok: 'text-estado-ok border-estado-ok/25 bg-estado-ok/10',
  erro: 'text-estado-erro border-estado-erro/25 bg-estado-erro/10',
  aviso: 'text-estado-aviso border-estado-aviso/25 bg-estado-aviso/10',
  info: 'text-estado-info border-estado-info/25 bg-estado-info/10',
  neutro: 'text-osso-suave border-linha bg-vidro',
};

export function Badge({ tom = 'neutro', children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${TONS_BADGE[tom]}`}>
      {children}
    </span>
  );
}

export function CabecalhoPagina({ etiqueta, titulo, descricao, acoes }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 mb-8" data-revelar>
      <div className="space-y-2">
        {etiqueta && <p className="etiqueta">{etiqueta}</p>}
        <h1 className="titulo-editorial text-3xl md:text-4xl">{titulo}</h1>
        {descricao && <p className="text-sm text-osso-suave max-w-xl">{descricao}</p>}
      </div>
      {acoes && <div className="flex items-center gap-3">{acoes}</div>}
    </header>
  );
}

export function Modal({ aberto, titulo, aoFechar, largura = 'max-w-lg', children }) {
  useEffect(() => {
    const aoTeclar = (evento) => evento.key === 'Escape' && aoFechar();
    if (aberto) window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, aoFechar]);

  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-grafite-950/80 backdrop-blur-sm" onClick={aoFechar} />
      <div className={`relative w-full ${largura} cartao bg-grafite-900/95 p-6 max-h-[88vh] overflow-y-auto`}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <h2 className="titulo-editorial text-xl">{titulo}</h2>
          <button onClick={aoFechar} className="text-osso-mudo hover:text-osso text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EstadoVazio({ titulo, descricao, acao }) {
  return (
    <div className="cartao p-12 text-center space-y-3" data-revelar>
      <p className="titulo-editorial text-xl text-osso-suave">{titulo}</p>
      {descricao && <p className="text-sm text-osso-mudo max-w-sm mx-auto">{descricao}</p>}
      {acao && <div className="pt-2">{acao}</div>}
    </div>
  );
}

export function Carregando() {
  return (
    <div className="flex justify-center py-16">
      <span className="h-6 w-6 rounded-full border-2 border-bronze border-t-transparent animate-spin" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts — avisar('mensagem', 'ok' | 'erro') de qualquer lugar.
// ---------------------------------------------------------------------------

export function avisar(mensagem, tom = 'ok') {
  window.dispatchEvent(new CustomEvent('aviso-ui', { detail: { mensagem, tom, id: Date.now() + Math.random() } }));
}

export function Avisos() {
  const [avisos, setAvisos] = useState([]);

  useEffect(() => {
    const aoAvisar = (evento) => {
      const aviso = evento.detail;
      setAvisos((atuais) => [...atuais, aviso]);
      setTimeout(() => setAvisos((atuais) => atuais.filter((a) => a.id !== aviso.id)), 4200);
    };
    window.addEventListener('aviso-ui', aoAvisar);
    return () => window.removeEventListener('aviso-ui', aoAvisar);
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-[60] space-y-2 w-80">
      {avisos.map((aviso) => (
        <div
          key={aviso.id}
          className={`cartao bg-grafite-900/95 px-4 py-3 text-sm border-l-2 ${
            aviso.tom === 'erro' ? 'border-l-estado-erro text-estado-erro' : 'border-l-estado-ok text-osso'
          }`}
        >
          {aviso.mensagem}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco de código com copiar — usado no gerador de embeds e credenciais n8n
// ---------------------------------------------------------------------------

export function BlocoCodigo({ codigo, rotulo }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    await navigator.clipboard.writeText(codigo);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };
  return (
    <div className="space-y-1.5">
      {rotulo && <p className="etiqueta">{rotulo}</p>}
      <div className="relative group">
        <pre className="cartao bg-grafite-900/90 p-4 text-xs leading-relaxed text-osso-suave overflow-x-auto whitespace-pre">
          {codigo}
        </pre>
        <button
          onClick={copiar}
          className="absolute top-2.5 right-2.5 rounded-campo border border-linha bg-grafite-850 px-2.5 py-1
            text-xs text-osso-suave opacity-0 group-hover:opacity-100 transition-opacity hover:text-osso"
        >
          {copiado ? 'Copiado ✓' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}

export const formatarData = (valor) =>
  valor
    ? new Date(valor).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
