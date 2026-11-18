package com.edrielton.lucky

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val sections = listOf("Início", "Chat", "Missões", "Memória", "Segurança")

class MainActivity : ComponentActivity() {
    private var generativeModel: GenerativeModel? = null

    var nanoStatus by mutableStateOf("Aguardando teste do AICore.")
        private set
    var nanoReply by mutableStateOf("")
        private set
    var isTestingNano by mutableStateOf(false)
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        generativeModel = Generation.getClient()
        setContent {
            MaterialTheme {
                LuckyMobileApp(
                    nanoStatus = nanoStatus,
                    nanoReply = nanoReply,
                    isTestingNano = isTestingNano,
                    onTestNano = ::testNano2
                )
            }
        }
    }

    private fun testNano2(prompt: String) {
        if (isTestingNano) return
        if (prompt.isBlank()) {
            nanoStatus = "Digite uma mensagem para testar o modelo."
            return
        }

        val model = generativeModel ?: run {
            nanoStatus = "Cliente AICore não inicializado."
            return
        }

        lifecycleScope.launch {
            isTestingNano = true
            nanoReply = ""
            nanoStatus = "Verificando disponibilidade do Gemini Nano..."

            try {
                val status = withContext(Dispatchers.IO) { model.checkStatus() }
                when (status) {
                    FeatureStatus.AVAILABLE -> {
                        nanoStatus = "Modelo disponível. Enviando prompt local..."
                        val result = withContext(Dispatchers.IO) {
                            model.generateContent(prompt)
                        }
                        nanoReply = result.candidates.firstOrNull()?.text
                            ?.takeIf { it.isNotBlank() }
                            ?: "O modelo não retornou texto."
                        nanoStatus = "Resposta recebida pelo AICore. Inferência solicitada pelo Lucky Mobile."
                    }
                    FeatureStatus.DOWNLOADABLE ->
                        nanoStatus = "O modelo da API está disponível para download, mas ainda não está instalado para este cliente. O AICore pode mostrar um modelo baixado diferente."
                    FeatureStatus.DOWNLOADING ->
                        nanoStatus = "O AICore ainda está baixando ou preparando o modelo. Tente novamente quando terminar."
                    FeatureStatus.UNAVAILABLE ->
                        nanoStatus = "A API informou que o modelo não está disponível para este app/dispositivo."
                    else ->
                        nanoStatus = "AICore retornou um estado desconhecido: $status"
                }
            } catch (error: Exception) {
                nanoStatus = "Falha no teste AICore: ${error.message ?: error::class.java.simpleName}"
            } finally {
                isTestingNano = false
            }
        }
    }

    override fun onDestroy() {
        generativeModel?.close()
        generativeModel = null
        super.onDestroy()
    }
}

@Composable
private fun LuckyMobileApp(
    nanoStatus: String,
    nanoReply: String,
    isTestingNano: Boolean,
    onTestNano: (String) -> Unit
) {
    var selectedSection by remember { mutableIntStateOf(0) }

    Scaffold(
        bottomBar = {
            NavigationBar {
                sections.forEachIndexed { index, label ->
                    NavigationBarItem(
                        selected = selectedSection == index,
                        onClick = { selectedSection = index },
                        icon = { Text(label.take(1)) },
                        label = { Text(label) }
                    )
                }
            }
        }
    ) { padding ->
        Surface(
            modifier = Modifier.fillMaxSize().padding(padding),
            color = MaterialTheme.colorScheme.background
        ) {
            Column(
                modifier = Modifier.fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("LUCKY", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "Assistente pessoal • Mobile",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                CoreStatusCard()
                when (selectedSection) {
                    0 -> HomeSection()
                    1 -> ChatSection(nanoStatus, nanoReply, isTestingNano, onTestNano)
                    2 -> PendingSection("Missões", "As missões ainda não estão conectadas ao armazenamento e ao executor do Lucky.")
                    3 -> PendingSection("Memória", "A memória estruturada do núcleo ainda não está disponível nesta interface.")
                    4 -> PendingSection("Segurança", "Approval Gate, auditoria e bloqueio de emergência precisam ser conectados ao núcleo antes de expor controles.")
                }
            }
        }
    }
}

@Composable
private fun CoreStatusCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Estado do núcleo", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("●", color = MaterialTheme.colorScheme.error)
                Text("Núcleo Lucky desconectado", style = MaterialTheme.typography.bodyLarge)
            }
            Text(
                "O teste do AICore é independente. Memória, missões e execução do núcleo ainda não estão integradas.",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun HomeSection() {
    Text("Painel", style = MaterialTheme.typography.titleLarge)
    Text(
        "A interface Android está pronta para validar a inferência local do Gemini Nano. O núcleo principal do Lucky permanece separado.",
        style = MaterialTheme.typography.bodyMedium
    )
    Spacer(modifier = Modifier.height(4.dp))
    Text("Componentes previstos", style = MaterialTheme.typography.titleMedium)
    listOf(
        "Chat local com AICore",
        "Missões e execução supervisionada",
        "Memória persistente",
        "Auditoria e aprovações",
        "Conselho de ministros, quando implementado no núcleo"
    ).forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
}

@Composable
private fun ChatSection(
    nanoStatus: String,
    nanoReply: String,
    isTestingNano: Boolean,
    onTestNano: (String) -> Unit
) {
    var prompt by remember {
        mutableStateOf("Olá, Lucky. Responda em português e diga que está rodando localmente.")
    }

    Text("Teste de IA local", style = MaterialTheme.typography.titleLarge)
    Text(
        "Este teste chama a API oficial ML Kit GenAI Prompt, baseada no Android AICore. Nenhuma missão ou ferramenta do Lucky será executada.",
        style = MaterialTheme.typography.bodyMedium
    )
    OutlinedTextField(
        value = prompt,
        onValueChange = { prompt = it },
        modifier = Modifier.fillMaxWidth(),
        label = { Text("Mensagem de teste") },
        minLines = 3
    )
    Button(
        onClick = { onTestNano(prompt) },
        enabled = !isTestingNano && prompt.isNotBlank(),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(if (isTestingNano) "Testando..." else "Testar Nano 2")
    }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Estado do teste", style = MaterialTheme.typography.titleMedium)
            Text(nanoStatus, style = MaterialTheme.typography.bodyMedium)
            if (nanoReply.isNotBlank()) {
                Text("Resposta do modelo", style = MaterialTheme.typography.titleMedium)
                Text(nanoReply, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
    Text(
        "A API usa o modelo estável disponível para o app. A versão efetivamente carregada precisa ser confirmada no dispositivo.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
}

@Composable
private fun PendingSection(title: String, detail: String) {
    Text(title, style = MaterialTheme.typography.titleLarge)
    Card(modifier = Modifier.fillMaxWidth()) {
        Text(detail, modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium)
    }
}
