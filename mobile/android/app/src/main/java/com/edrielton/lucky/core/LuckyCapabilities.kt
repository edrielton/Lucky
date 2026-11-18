package com.edrielton.lucky.core

/**
 * Capacidades internas do Lucky.
 * São responsabilidades do próprio núcleo, não ministros, agentes ou personas independentes.
 */
data class LuckyCapability(val name: String, val responsibility: String, val state: String)

object LuckyCapabilities {
    val all = listOf(
        LuckyCapability("Estratégia", "Planejamento, prioridades e objetivos de longo prazo", "INTERNO"),
        LuckyCapability("Previsão", "Cenários, consequências e avaliação de incerteza", "INTERNO"),
        LuckyCapability("Integração", "Coordenação dos módulos e consistência de estado", "INTERNO"),
        LuckyCapability("Engenharia", "Arquitetura, implementação e manutenção de software", "PARCIAL"),
        LuckyCapability("Segurança", "Políticas, permissões, proteção e resposta a riscos", "PARCIAL"),
        LuckyCapability("Memória", "Persistência, recuperação, atualização e histórico", "PARCIAL"),
        LuckyCapability("Análise", "Raciocínio, decomposição e diagnóstico de problemas", "INTERNO"),
        LuckyCapability("Verificação", "Auditoria, testes, evidências e detecção de regressões", "PENDENTE"),
        LuckyCapability("Comunicação", "Interpretação de intenção e interação com o usuário", "INTERNO"),
        LuckyCapability("Pesquisa", "Aquisição e organização de conhecimento", "DEPENDENTE_DO_PROVEDOR"),
        LuckyCapability("Observabilidade", "Monitoramento de estado, eventos e desempenho", "PARCIAL"),
        LuckyCapability("Planejamento", "Sequenciamento, prazos e gestão de missões", "PARCIAL"),
        LuckyCapability("Governança", "Aprovação humana, políticas e trilha de auditoria", "PARCIAL"),
        LuckyCapability("Gestão de recursos", "Uso de memória, processamento, armazenamento e limites", "PENDENTE"),
        LuckyCapability("Autodesenvolvimento", "Inspeção de projeto, alterações isoladas, execução de testes e promoção aprovada", "NAO_IMPLEMENTADO")
    )
}
