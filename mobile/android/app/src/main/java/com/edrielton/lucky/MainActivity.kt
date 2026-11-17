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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

private val sections = listOf("Início", "Chat", "Missões", "Memória", "Segurança")

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                LuckyMobileApp()
            }
        }
    }
}

@Composable
private fun LuckyMobileApp() {
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
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            color = MaterialTheme.colorScheme.background
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
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
                    1 -> PendingSection(
                        title = "Chat",
                        detail = "O chat será habilitado quando o núcleo real estiver integrado."
                    )
                    2 -> PendingSection(
                        title = "Missões",
                        detail = "As missões ainda não estão conectadas ao armazenamento e ao executor do Lucky."
                    )
                    3 -> PendingSection(
                        title = "Memória",
                        detail = "A memória estruturada do núcleo ainda não está disponível nesta interface."
                    )
                    4 -> PendingSection(
                        title = "Segurança",
                        detail = "Approval Gate, auditoria e bloqueio de emergência precisam ser conectados ao núcleo antes de expor controles."
                    )
                }
            }
        }
    }
}

@Composable
private fun CoreStatusCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("Estado do núcleo", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("●", color = MaterialTheme.colorScheme.error)
                Text("Desconectado", style = MaterialTheme.typography.bodyLarge)
            }
            Text(
                "Esta versão é somente a fundação da interface. Nenhuma ação está sendo simulada ou executada.",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun HomeSection() {
    Text("Painel", style = MaterialTheme.typography.titleLarge)
    Text(
        "A interface Android foi criada. A próxima etapa é integrar o núcleo local sem remover suas políticas de segurança, memória ou auditoria.",
        style = MaterialTheme.typography.bodyMedium
    )
    Spacer(modifier = Modifier.height(4.dp))
    Text("Componentes previstos", style = MaterialTheme.typography.titleMedium)
    listOf(
        "Chat e comunicação por voz",
        "Missões e execução supervisionada",
        "Memória persistente",
        "Auditoria e aprovações",
        "Conselho de ministros, quando implementado no núcleo"
    ).forEach { item ->
        Text("• $item", style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun PendingSection(title: String, detail: String) {
    Text(title, style = MaterialTheme.typography.titleLarge)
    Card(modifier = Modifier.fillMaxWidth()) {
        Text(
            detail,
            modifier = Modifier.padding(16.dp),
            style = MaterialTheme.typography.bodyMedium
        )
    }
}
