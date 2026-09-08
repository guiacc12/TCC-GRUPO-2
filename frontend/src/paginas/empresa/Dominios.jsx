import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Botao, CabecalhoPagina, Campo, Carregando, EstadoVazio, avisar, formatarData } from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

export default function Dominios() {
  const [dominios, setDominios] = useState(null);
  const [novo, setNovo] = useState('');
  const [carregando, setCarregando] = useState(false);
  const ref = useRevelar([dominios !== null]);

  async function carregar() {
    const dados = await api('/api/empresa/dominios');
    setDominios(dados.dominios);
  }
  useEffect(() => {
    carregar().catch((erro) => avisar(erro.message, 'erro'));
  }, []);

  async function adicionar(evento) {
    evento.preventDefault();
    setCarregando(true);
    try {
      await api('/api/empresa/dominios', { metodo: 'POST', corpo: { dominio: novo } });
      avisar('Domínio liberado para captura.');
      setNovo('');
      carregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setCarregando(false);
    }
  }

  async function remover(dominio) {
    if (!window.confirm(`Remover ${dominio.dominio}? Formulários nesse site deixarão de enviar.`)) return;
    try {
      await api(`/api/empresa/dominios/${dominio.id}`, { metodo: 'DELETE' });
      avisar('Domínio removido.');
      carregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  if (!dominios) return <Carregando />;

  return (
    <div ref={ref}>
      <CabecalhoPagina
        etiqueta="Segurança"
        titulo="Domínios autorizados"
        descricao="Somente sites cadastrados aqui podem enviar leads pelos seus formulários (CORS)."
      />

      <form onSubmit={adicionar} className="cartao p-4 mb-6 flex gap-3 items-end max-w-2xl" data-revelar>
        <div className="flex-1">
          <Campo
            rotulo="URL do site" type="url" value={novo} onChange={(e) => setNovo(e.target.value)}
            placeholder="https://meusite.com.br" required
            dica="Só o domínio conta — caminhos são ignorados."
          />
        </div>
        <div className="pb-6">
          <Botao type="submit" carregando={carregando}>Adicionar</Botao>
        </div>
      </form>

      {dominios.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum domínio cadastrado"
          descricao="Adicione o domínio das suas páginas de captura antes de publicar os formulários."
        />
      ) : (
        <div className="cartao divide-y divide-[rgba(233,229,220,0.06)] max-w-2xl" data-revelar>
          {dominios.map((dominio) => (
            <div key={dominio.id} className="flex items-center gap-4 px-5 py-3.5">
              <p className="flex-1 text-sm">{dominio.dominio}</p>
              <span className="text-xs text-osso-mudo">{formatarData(dominio.criado_em)}</span>
              <button onClick={() => remover(dominio)} className="text-xs text-estado-erro/70 hover:text-estado-erro">
                remover
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
