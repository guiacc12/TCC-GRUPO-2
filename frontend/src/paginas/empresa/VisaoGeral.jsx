import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, sessao } from '../../lib/api.js';
import { Badge, CabecalhoPagina, Carregando, formatarData } from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

const TOM_STATUS = { novo: 'info', processando: 'aviso', entregue: 'ok', erro: 'erro' };

export default function VisaoGeral() {
  const [resumo, setResumo] = useState(null);
  const ref = useRevelar([resumo !== null]);
  const nome = sessao.obter('empresa')?.usuario?.nome?.split(' ')[0];

  useEffect(() => {
    (async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      // O total filtrado da listagem serve de contador — sem endpoint dedicado
      const [todos, entregues, erros, doDia] = await Promise.all([
        api('/api/empresa/leads?por_pagina=8'),
        api('/api/empresa/leads?status=entregue&por_pagina=1'),
        api('/api/empresa/leads?status=erro&por_pagina=1'),
        api(`/api/empresa/leads?de=${hoje}&por_pagina=1`),
      ]);
      setResumo({
        total: todos.total,
        entregues: entregues.total,
        erros: erros.total,
        hoje: doDia.total,
        recentes: todos.leads,
      });
    })().catch(() => setResumo({ total: 0, entregues: 0, erros: 0, hoje: 0, recentes: [] }));
  }, []);

  if (!resumo) return <Carregando />;

  const indicadores = [
    { rotulo: 'Leads capturados', valor: resumo.total, destaque: true },
    { rotulo: 'Hoje', valor: resumo.hoje },
    { rotulo: 'Entregues no CRM', valor: resumo.entregues },
    { rotulo: 'Com erro', valor: resumo.erros, alerta: resumo.erros > 0 },
  ];

  return (
    <div ref={ref}>
      <CabecalhoPagina
        etiqueta="Visão geral"
        titulo={nome ? `Olá, ${nome}.` : 'Olá.'}
        descricao="O pulso da sua captação — leads, entregas e o que precisa de atenção."
      />

      {/* Grid assimétrico: indicador principal em coluna dupla */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-10">
        {indicadores.map((item) => (
          <article
            key={item.rotulo}
            data-revelar
            className={`cartao p-5 ${item.destaque ? 'col-span-2 bg-vidro-forte' : ''}`}
          >
            <p className="etiqueta">{item.rotulo}</p>
            <p
              className={`font-editorial mt-2 ${item.destaque ? 'text-5xl' : 'text-3xl'} ${
                item.alerta ? 'text-estado-erro' : item.destaque ? 'text-bronze-claro' : ''
              }`}
            >
              {item.valor}
            </p>
          </article>
        ))}
      </section>

      <section data-revelar>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="titulo-editorial text-xl">Últimos leads</h2>
          <Link to="/painel/leads" className="text-xs text-bronze hover:text-bronze-claro">
            ver todos →
          </Link>
        </div>

        {resumo.recentes.length === 0 ? (
          <div className="cartao p-10 text-center text-sm text-osso-mudo">
            Nenhum lead ainda. Crie um formulário e publique o embed para começar a capturar.
          </div>
        ) : (
          <div className="cartao divide-y divide-[rgba(233,229,220,0.06)]">
            {resumo.recentes.map((lead) => (
              <Link
                key={lead.id}
                to={`/painel/leads?abrir=${lead.id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-vidro transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{lead.nome || lead.email || lead.telefone || `Lead #${lead.id}`}</p>
                  <p className="text-xs text-osso-mudo truncate">
                    {lead.formulario_nome || 'formulário removido'}
                    {lead.utm_source ? ` · ${lead.utm_source}` : ''}
                  </p>
                </div>
                <Badge tom={TOM_STATUS[lead.status]}>{lead.status}</Badge>
                <span className="text-xs text-osso-mudo w-28 text-right">{formatarData(lead.criado_em)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
