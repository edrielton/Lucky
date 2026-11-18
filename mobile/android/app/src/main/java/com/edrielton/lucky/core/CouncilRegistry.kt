package com.edrielton.lucky.core

data class Minister(val name: String, val responsibility: String)

object CouncilRegistry {
    val president = "LUCKY"
    val ministers = listOf(
        Minister("ATLAS", "Estratégia e direção de longo prazo"),
        Minister("ORACLE", "Previsões, cenários e avaliação de consequências"),
        Minister("NEXUS", "Integração entre módulos e coordenação técnica"),
        Minister("PATCH", "Diagnóstico e correção de falhas"),
        Minister("SENTINEL", "Segurança, proteção e identificação de riscos"),
        Minister("ARCHIVUS", "Memória, histórico e preservação do conhecimento"),
        Minister("ANALYTIC", "Análise, raciocínio e decomposição de problemas"),
        Minister("FORGE", "Engenharia, arquitetura e desenvolvimento de software"),
        Minister("VERITAS", "Verificação, auditoria e validação de resultados"),
        Minister("LINGUA", "Comunicação e interação com o usuário"),
        Minister("ADVERSARY", "Contestação de hipóteses e análise crítica"),
        Minister("SCIENTIA", "Pesquisa, aquisição e organização de conhecimento"),
        Minister("OBSERVER", "Monitoramento de estado, eventos e comportamento"),
        Minister("CHRONOS", "Planejamento temporal, prazos e sequenciamento"),
        Minister("EQUITAS", "Governança, políticas e permissões"),
        Minister("LEGATUS", "Representação do usuário: traduz solicitações em requisitos, comunica atualizações, acompanha entregas e preserva a intenção original"),
        Minister("STEWARD", "Gestão de recursos: memória, processamento e armazenamento; identifica gargalos, prioriza tarefas e evita sobrecargas")
    )

    // Registry only: these roles are documented, not yet independent autonomous agents.
    val plannedEngines = listOf(
        "Council Engine", "Consensus Engine", "Decision Ledger", "Autonomy Kernel",
        "Simulation Engine", "Execution Sandbox", "Approval Gate / Produção",
        "Mission Control", "Black Box", "Recovery Core", "Knowledge Graph",
        "Watchtower", "Policy Engine", "Performance Monitor"
    )
}
