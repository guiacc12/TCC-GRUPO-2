import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Botao, CabecalhoPagina, Campo, Carregando, EstadoVazio, avisar, formatarData } from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

export default function Dominios() {
  const [dominios, setDominios] = useState(null);
  const [novo, setNovo] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [edicao, setEdicao] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erroEdicao, setErroEdicao] = useState('');
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
      await carregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setCarregando(false);
    }
  }

  async function salvarEdicao(evento) {
    evento.preventDefault();
    if (salvando) return;
    setSalvando(true);
    setErroEdicao('');
    try {
      const dados = await api(`/api/empresa/dominios/${edicao.id}`, {
        metodo: 'PUT', corpo: { dominio: edicao.dominio },
      });
      setDominios((atuais) => atuais.map((dominio) => (
        dominio.id === edicao.id ? { ...dominio, dominio: dados.dominio } : dominio
      )));
      setEdicao(null);
      avisar('Domínio atualizado. A nova origem já está liberada para captura.');
    } catch (erro) {
      setErroEdicao(erro.message);
    } finally {
      setSalvando(false);
    }
  }

  async function remover(dominio) {
    if (!window.confirm(`Remover ${dominio.dominio}? Formulários nesse site deixarão de enviar.`)) return;
    try {
      await api(`/api/empresa/dominios/${dominio.id}`, { metodo: 'DELETE' });
      avisar('Domínio removido.');
      await carregar();
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

      <form onSubmit={adicionar} className="cartao p-4 mb-6 flex flex-col sm:flex-row gap-3 sm:items-end max-w-2xl" data-revelar>
        <div className="w-full flex-1 min-w-0">
          <Campo
            rotulo="URL do site" type="url" value={novo} onChange={(e) => setNovo(e.target.value)}
            placeholder="https://meusite.com.br" required disabled={!!edicao}
            dica="Só o domínio conta — caminhos são ignorados."
          />
        </div>
        <div className="sm:pb-6">
          <Botao type="submit" carregando={carregando} disabled={carregando || !!edicao}>Adicionar</Botao>
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
            <div key={dominio.id} className="px-5 py-3.5">
              {edicao?.id === dominio.id ? (
                <form onSubmit={salvarEdicao} className="space-y-4" aria-label="Editar domínio" aria-busy={salvando}>
                  <Campo
                    rotulo="Editar URL do site" type="url" value={edicao.dominio} required autoFocus
                    onChange={(evento) => setEdicao({ ...edicao, dominio: evento.target.value })}
                    disabled={salvando} aria-invalid={!!erroEdicao} aria-describedby="aviso-edicao-dominio"
                  />
                  <p id="aviso-edicao-dominio" className="text-xs text-osso-mudo">
                    Use HTTP ou HTTPS. Caminhos são ignorados. Ao salvar, o endereço anterior deixará de aceitar novas capturas.
                  </p>
                  {erroEdicao && <p role="alert" className="text-sm text-estado-erro">{erroEdicao}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Botao type="submit" carregando={salvando}>Salvar alterações</Botao>
                    <Botao type="button" variante="fantasma" disabled={salvando} onClick={() => setEdicao(null)}>
                      Cancelar
                    </Botao>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p className="w-full sm:w-auto sm:flex-1 min-w-0 break-all text-sm">{dominio.dominio}</p>
                  <span className="text-xs text-osso-mudo">{formatarData(dominio.criado_em)}</span>
                  <button
                    onClick={() => { setEdicao({ id: dominio.id, dominio: dominio.dominio }); setErroEdicao(''); }}
                    disabled={!!edicao || carregando} aria-label={`Editar ${dominio.dominio}`}
                    className="py-2 text-xs text-osso-suave hover:text-osso disabled:opacity-40"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => remover(dominio)} disabled={!!edicao || carregando}
                    aria-label={`Remover ${dominio.dominio}`}
                    className="py-2 text-xs text-estado-erro/70 hover:text-estado-erro disabled:opacity-40"
                  >
                    remover
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
