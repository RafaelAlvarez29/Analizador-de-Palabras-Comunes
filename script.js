document.addEventListener('DOMContentLoaded', () => {
    // --- Selección de Elementos del DOM ---
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const fileInput = document.getElementById('file-input');
    const fileNameDisplay = document.getElementById('file-name-display');
    const folderInfo = document.getElementById('folder-info');
    const searchBtn = document.getElementById('search-btn');
    const searchBtnText = document.querySelector('#search-btn .btn-text');
    const loader = document.querySelector('#search-btn .loader');
    const statusMessage = document.getElementById('status-message');
    const errorMessage = document.getElementById('error-message');
    const resultsArea = document.getElementById('results-area');
    const toggleWidthBtn = document.getElementById('toggleWidthBtn');
    const resultsContainer = document.getElementById('results-container');
    const saveCsvBtn = document.getElementById('save-csv-btn');
    const finalSummaryContainer = document.getElementById('final-summary-container');

    // Elementos para el campo de tags
    const tagContainer = document.getElementById('tag-container');
    const keywordsInputField = document.getElementById('keywords-input-field');

    // Elementos para el modal de ayuda
    const openHelpBtn = document.getElementById('openHelpBtn');
    const helpModal = document.getElementById('helpModal');
    const closeModalBtn = document.getElementById('closeModalBtn');

    // --- NUEVO: Iconos SVG como constantes ---
    const expandIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
    const contractIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>`;
    let selectedFiles = [];
    let lastAnalysisData = null;

    let totalBarChart = null;
    let radarChart = null;
    // Usaremos un objeto para los gráficos de pastel, ya que habrá varios
    let pieCharts = {};
    // --- LÓGICA PARA INPUT DE TAGS/BADGES ---
    const createTag = (text) => {
        const cleanedText = text.trim().toLowerCase();
        if (!cleanedText) return;

        const existingTags = Array.from(tagContainer.querySelectorAll('.tag-badge span')).map(span => span.textContent);
        if (existingTags.includes(cleanedText)) {
            keywordsInputField.value = '';
            return;
        }

        const tagBadge = document.createElement('div');
        tagBadge.className = 'tag-badge';

        const tagText = document.createElement('span');
        tagText.textContent = cleanedText;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'tag-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.setAttribute('aria-label', `Eliminar ${cleanedText}`);

        tagBadge.appendChild(tagText);
        tagBadge.appendChild(removeBtn);

        tagContainer.insertBefore(tagBadge, keywordsInputField);
        keywordsInputField.value = '';
    };

    keywordsInputField.addEventListener('keydown', (e) => {
        if (e.key === ',' || e.key === 'Enter') {
            e.preventDefault();
            createTag(keywordsInputField.value);
        }
    });

    keywordsInputField.addEventListener('blur', () => {
        createTag(keywordsInputField.value);
    });

    tagContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('tag-remove')) {
            e.target.parentElement.remove();
        } else if (e.target === tagContainer) {
            keywordsInputField.focus();
        }
    });

    const getKeywordsFromTags = () => {
        return Array.from(tagContainer.querySelectorAll('.tag-badge span')).map(span => span.textContent);
    };

    // --- Funciones de UI y Feedback ---
    const showLoader = (show) => {
        searchBtnText.classList.toggle('hidden', show);
        loader.classList.toggle('hidden', !show);
        searchBtn.disabled = show;
    };

    const showMessage = (element, message) => {
        element.textContent = message;
        element.classList.remove('hidden');
    };

    const hideMessages = () => {
        errorMessage.classList.add('hidden');
        statusMessage.classList.add('hidden');
    };

    // --- Manejo de Selección de Carpeta ---
    fileInput.addEventListener('change', () => {
        hideMessages();
        selectedFiles = Array.from(fileInput.files);
        if (selectedFiles.length > 0) {
            const rootFolderName = selectedFiles[0].webkitRelativePath.split('/')[0];
            fileNameDisplay.innerHTML = `Carpeta seleccionada: <strong>${rootFolderName}</strong>`;
            const supportedFiles = selectedFiles.filter(f => /\.(pdf|docx|pptx)$/i.test(f.name));
            folderInfo.textContent = `${supportedFiles.length} archivos compatibles encontrados.`;
        } else {
            fileNameDisplay.innerHTML = `<strong>Haz clic para seleccionar una carpeta</strong>`;
            folderInfo.textContent = '';
        }
    });

    // --- Funciones de Extracción de Texto ---
    const extractTextFromPdf = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const pdf = await pdfjsLib.getDocument({ data: e.target.result }).promise;
                let textContent = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const text = await page.getTextContent();
                    textContent += text.items.map(s => s.str).join(' ') + '\n';
                }
                resolve(textContent);
            } catch (error) { reject('Error al procesar el archivo PDF.'); }
        };
        reader.onerror = () => reject('Error al leer el archivo.');
        reader.readAsArrayBuffer(file);
    });

    const extractTextFromDocx = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            mammoth.extractRawText({ arrayBuffer: e.target.result })
                .then(result => resolve(result.value))
                .catch(() => reject('Error al procesar el archivo DOCX.'));
        };
        reader.onerror = () => reject('Error al leer el archivo.');
        reader.readAsArrayBuffer(file);
    });

    const extractTextFromPptx = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            JSZip.loadAsync(e.target.result).then(zip => {
                const slidePromises = [];
                zip.folder('ppt/slides').forEach((relativePath, file) => {
                    if (relativePath.startsWith('slide') && relativePath.endsWith('.xml')) {
                        slidePromises.push(file.async('string'));
                    }
                });
                return Promise.all(slidePromises);
            }).then(slidesXml => {
                const textContent = slidesXml.map(xml => {
                    const textNodes = xml.match(/<a:t>(.*?)<\/a:t>/g) || [];
                    return textNodes.map(node => node.replace(/<a:t>|<\/a:t>/g, '')).join(' ');
                }).join('\n');
                resolve(textContent);
            }).catch(() => reject('Error al procesar el archivo PPTX.'));
        };
        reader.onerror = () => reject('Error al leer el archivo.');
        reader.readAsArrayBuffer(file);
    });

    // --- Lógica Principal de Análisis ---
    searchBtn.addEventListener('click', async () => {
        // --- PASO 1: Limpieza inicial de la interfaz ---
        hideMessages();
        resultsArea.classList.add('hidden');
        resultsContainer.innerHTML = '';
        finalSummaryContainer.innerHTML = '';
        lastAnalysisData = null;

        // --- PASO 2 (¡NUEVO!): Destruir los gráficos de la búsqueda anterior ---
        // Esto es crucial para evitar que los gráficos viejos se queden "flotando"
        // o causen errores al intentar dibujar sobre el mismo canvas.
        if (totalBarChart) {
            totalBarChart.destroy();
            totalBarChart = null; // Liberar la referencia
        }
        if (radarChart) {
            radarChart.destroy();
            radarChart = null; // Liberar la referencia
        }
        Object.values(pieCharts).forEach(chart => chart.destroy());
        pieCharts = {}; // Limpiar el objeto de gráficos de pastel

        // --- PASO 3: Validación de entradas (como antes) ---
        const selectedFiles = Array.from(fileInput.files);
        if (selectedFiles.length === 0) {
            showMessage(errorMessage, 'Por favor, selecciona una carpeta.');
            return;
        }

        const keywordList = getKeywordsFromTags();
        if (keywordList.length === 0) {
            showMessage(errorMessage, 'Por favor, ingresa al menos una palabra clave.');
            return;
        }

        // --- PASO 4: Preparación para el análisis (como antes) ---
        showLoader(true);
        const supportedFiles = selectedFiles.filter(f => /\.(pdf|docx|pptx)$/i.test(f.name));
        if (supportedFiles.length === 0) {
            showLoader(false);
            showMessage(errorMessage, 'La carpeta no contiene archivos compatibles (.pdf, .docx, .pptx).');
            return;
        }
        showMessage(statusMessage, `Procesando ${supportedFiles.length} archivos...`);

        // --- PASO 5: Ejecución del análisis (como antes) ---
        const processingPromises = supportedFiles.map(file => processFile(file, keywordList));
        const results = await Promise.allSettled(processingPromises);
        const analysisData = aggregateResults(results);
        lastAnalysisData = analysisData;

        // --- PASO 6: Renderizado de resultados en la interfaz ---

        // a) Muestra las tablas interactivas (y crea los gráficos de pastel dentro de esta función)
        displayResults(analysisData, keywordList);

        // b) Muestra el resumen de texto con las conclusiones
        generateFinalSummary(analysisData, keywordList);

        // c) (¡NUEVO!) Llama a la función que crea los gráficos globales (barras y radar)
        generateCharts(analysisData, keywordList);

        // --- PASO 7: Mostrar todo y finalizar (como antes) ---
        resultsArea.classList.remove('hidden');
        hideMessages();
        showLoader(false);
        resultsArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

    });
    const processFile = async (file, keywordList) => {
        const pathParts = file.webkitRelativePath.split('/');
        const category = pathParts.length > 1 ? pathParts[pathParts.length - 2] : 'Raíz';
        const fileName = file.name;
        const extension = fileName.split('.').pop().toLowerCase();
        let text = '';

        try {
            if (extension === 'pdf') text = await extractTextFromPdf(file);
            else if (extension === 'docx') text = await extractTextFromDocx(file);
            else if (extension === 'pptx') text = await extractTextFromPptx(file);
        } catch (error) {
            console.error(`Error procesando ${fileName}:`, error);
            return Promise.reject({ fileName, error });
        }

        // --- SECCIÓN DE LIMPIEZA Y NORMALIZACIÓN DE TEXTO (LA SOLUCIÓN) ---

        // Paso 1: Eliminar caracteres invisibles y no estándar.
        // Esta regex conserva letras (incluyendo acentos en español), números, y puntuación básica.
        // Todo lo demás (como guiones suaves \u00AD) se reemplaza por un espacio.
        let cleanedText = text.replace(/[^a-zA-Z0-9\s.,;üéáíóúñÜÉÁÍÓÚÑ-]/g, ' ');

        // Paso 2: Normalizar todos los espacios en blanco a un solo espacio.
        // Esto arregla los espacios extra que pudieron crearse en el paso anterior.
        cleanedText = cleanedText.replace(/\s+/g, ' ');

        // Paso 3: Convertir a minúsculas para la búsqueda.
        const textLower = cleanedText.toLowerCase();

        // --- LÓGICA DE BÚSQUEDA (sin cambios, ahora funciona sobre texto limpio) ---
        const results = {};
        const CONTEXT_LENGTH = 70;

        keywordList.forEach(keyword => {
            const safeKeyword = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp('\\b' + safeKeyword + '\\b', 'g');

            results[keyword] = { count: 0, contexts: [] };

            let match;
            while ((match = regex.exec(textLower)) !== null) {
                results[keyword].count++;

                const startIndex = Math.max(0, match.index - CONTEXT_LENGTH);
                const endIndex = Math.min(cleanedText.length, match.index + keyword.length + CONTEXT_LENGTH);

                // Usamos el texto original (cleanedText) para el snippet para preservar mayúsculas
                let snippet = cleanedText.substring(startIndex, endIndex);

                if (startIndex > 0) snippet = '... ' + snippet;
                if (endIndex < cleanedText.length) snippet += ' ...';

                const highlightRegex = new RegExp(`(${safeKeyword})`, 'gi');
                snippet = snippet.replace(highlightRegex, '<strong>$1</strong>');

                results[keyword].contexts.push(snippet);
            }
        });

        return { category, fileName, results };
    };

    const aggregateResults = (results) => {
        const data = {};
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                // Desestructuramos el nuevo objeto de resultados
                const { category, fileName, results: fileResults } = result.value;

                if (!data[category]) {
                    data[category] = { summary: {}, details: {}, fileCount: 0, processedFiles: new Set() };
                }
                if (!data[category].processedFiles.has(fileName)) {
                    data[category].fileCount++;
                    data[category].processedFiles.add(fileName);
                }

                // Iteramos sobre los resultados por palabra clave
                for (const keyword in fileResults) {
                    const keywordData = fileResults[keyword];
                    if (keywordData.count > 0) {
                        // Sumamos al total de la categoría
                        data[category].summary[keyword] = (data[category].summary[keyword] || 0) + keywordData.count;

                        // Creamos el array de detalles si no existe
                        if (!data[category].details[keyword]) {
                            data[category].details[keyword] = [];
                        }

                        // Añadimos el objeto de detalle del archivo, incluyendo los contextos
                        data[category].details[keyword].push({
                            file: fileName,
                            count: keywordData.count,
                            contexts: keywordData.contexts
                        });
                    }
                }
            }
        });
        return data;
    };

    const displayResults = (analysisData, keywordList) => {
        // 1. Limpiar el contenedor de resultados principal
        resultsContainer.innerHTML = '';

        // 2. Comprobar si hay datos para mostrar
        if (Object.keys(analysisData).length === 0) {
            resultsContainer.innerHTML = '<p class="no-results-message">No se encontraron resultados para los archivos y palabras clave proporcionados.</p>';
            return;
        }

        // 3. Iterar sobre cada categoría (materia) para crear su sección
        for (const category in analysisData) {
            const categoryData = analysisData[category];
            const section = document.createElement('section');
            section.className = 'category-section';

            // 4. Generar el HTML para la tabla interactiva (lado izquierdo de la cuadrícula)
            let tableHtml = `<div class="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th style="width: 20px;"></th>
                                        <th>Palabra Clave</th>
                                        <th>Total</th>
                                    </tr>
                                </thead>
                                <tbody>`;

            keywordList.forEach(keyword => {
                const totalCount = categoryData.summary[keyword] || 0;
                const details = categoryData.details[keyword];

                // Solo añadir una fila si la palabra se encontró en esta categoría
                if (totalCount > 0) {
                    // Fila principal expandible
                    tableHtml += `<tr class="parent-row" data-keyword="${keyword}">
                                <td><span class="toggle-icon">▸</span></td>
                                <td>${keyword}</td>
                                <td>${totalCount}</td>
                              </tr>`;

                    // Filas de detalle (ocultas por defecto)
                    if (details) {
                        details.sort((a, b) => b.count - a.count).forEach(item => {
                            // Generamos la lista de contextos si existen
                            let contextsHtml = '';
                            if (item.contexts && item.contexts.length > 0) {
                                contextsHtml = '<div class="context-list">';
                                item.contexts.forEach(context => {
                                    // Usamos innerHTML para que la etiqueta <strong> funcione
                                    contextsHtml += `<div class="context-snippet">${context}</div>`;
                                });
                                contextsHtml += '</div>';
                            }

                            // Añadimos la fila de detalle con el nombre del archivo y la lista de contextos
                            tableHtml += `<tr class="detail-row hidden" data-parent-keyword="${keyword}">
                    <td></td>
                    <td class="file-name-cell">
                        ${item.file}
                        ${contextsHtml}  <!-- Aquí insertamos los contextos -->
                    </td>
                    <td>${item.count}</td>
                  </tr>`;
                        });
                    }
                }
            });
            tableHtml += `</tbody></table></div>`;

            // 5. Ensamblar la estructura final de la sección usando la cuadrícula
            // Se coloca la tabla y el contenedor para el gráfico de pastel.
            section.innerHTML = `
            <h2 class="category-header">${category} (${categoryData.fileCount} archivos)</h2>
            
            <!-- Estructura de la cuadrícula para alinear tabla y gráfico -->
            <div class="category-content-grid">
                
                <!-- Contenedor para la tabla -->
                <div class="table-container">
                    ${tableHtml}
                </div>
                
                <!-- Contenedor para el gráfico de pastel -->
                <div class="chart-container">
                    <h3>Proporción por Palabra</h3>
                    <canvas id="pieChart-${category}"></canvas>
                </div>

            </div>
        `;

            // 6. Añadir la sección completa al DOM
            resultsContainer.appendChild(section);

            // 7. (¡CRUCIAL!) Llamar a la función que crea el gráfico de pastel DESPUÉS
            // de que el canvas ya existe en la página.
            createPieChartForCategory(category, categoryData, keywordList);
        }
    };

    resultsContainer.addEventListener('click', (e) => {
        const parentRow = e.target.closest('.parent-row');
        if (!parentRow) return;

        const keyword = parentRow.dataset.keyword;
        const tableBody = parentRow.closest('tbody');
        const detailRows = tableBody.querySelectorAll(`.detail-row[data-parent-keyword="${keyword}"]`);
        const icon = parentRow.querySelector('.toggle-icon');

        let areHidden = true;
        detailRows.forEach(row => {
            row.classList.toggle('hidden');
            if (!row.classList.contains('hidden')) areHidden = false;
        });

        icon.textContent = areHidden ? '▸' : '▾';
        parentRow.classList.toggle('expanded', !areHidden);
    });

    const generateFinalSummary = (analysisData, keywordList) => {
        finalSummaryContainer.innerHTML = '';
        let html = '';
        const totalCounts = {};
        const categoryPresence = {};

        keywordList.forEach(k => {
            totalCounts[k] = 0;
            categoryPresence[k] = { count: 0, categories: new Set() };
        });

        for (const category in analysisData) {
            for (const keyword of keywordList) {
                const count = analysisData[category].summary[keyword] || 0;
                if (count > 0) {
                    totalCounts[keyword] += count;
                    if (!categoryPresence[keyword].categories.has(category)) {
                        categoryPresence[keyword].count++;
                        categoryPresence[keyword].categories.add(category);
                    }
                }
            }
        }

        const grandTotal = Object.values(totalCounts).reduce((sum, count) => sum + count, 0);
        if (grandTotal === 0) {
            finalSummaryContainer.innerHTML = '<p>No se encontraron las palabras clave en ningún documento. No se puede generar un análisis general.</p>';
            return;
        }

        const foundKeywords = Object.keys(totalCounts).filter(k => totalCounts[k] > 0);

        if (foundKeywords.length > 0) {
            const mostFrequentWord = foundKeywords.reduce((a, b) => totalCounts[a] > totalCounts[b] ? a : b);
            html += `<p>La palabra más frecuente es <strong>"${mostFrequentWord}"</strong>, con un total de ${totalCounts[mostFrequentWord]} apariciones.</p>`;

            const mostSharedWord = foundKeywords.reduce((a, b) => categoryPresence[a].count > categoryPresence[b].count ? a : b);
            const numCategories = Object.keys(analysisData).length;
            html += `<p>La palabra más compartida es <strong>"${mostSharedWord}"</strong>, apareciendo en ${categoryPresence[mostSharedWord].count} de ${numCategories} materias distintas.</p>`;
        }

        html += `<p><strong>Palabras distintivas por materia:</strong></p><ul>`;
        let distinctiveFound = false;
        for (const category in analysisData) {
            let distinctiveWord = '', maxRatio = -1;
            for (const keyword of foundKeywords) {
                const countInCategory = analysisData[category].summary[keyword] || 0;
                const totalCountForKeyword = totalCounts[keyword];
                if (totalCountForKeyword > 0) {
                    const ratio = countInCategory / totalCountForKeyword;
                    if (ratio > maxRatio) {
                        maxRatio = ratio;
                        distinctiveWord = keyword;
                    }
                }
            }
            if (distinctiveWord && maxRatio > 0.5 && (analysisData[category].summary[distinctiveWord] || 0) > 0) {
                html += `<li>Para <strong>${category}</strong>, <strong>"${distinctiveWord}"</strong> parece ser un término clave (concentra el ${Math.round(maxRatio * 100)}% de sus apariciones).</li>`;
                distinctiveFound = true;
            }
        }
        if (!distinctiveFound) html += `<li>No se encontraron palabras suficientemente distintivas.</li>`;
        html += `</ul>`;

        finalSummaryContainer.innerHTML = html;
    };

    saveCsvBtn.addEventListener('click', () => {
        if (!lastAnalysisData) {
            alert("No hay datos de análisis para guardar. Por favor, realiza un análisis primero.");
            return;
        }

        // --- Parte 1: Generar el detalle (como antes) ---
        const detailRows = [["Categoria", "Palabra Clave", "Total Apariciones", "Archivos con la Palabra (cantidad)"]];
        for (const category in lastAnalysisData) {
            const categoryData = lastAnalysisData[category];
            const keywordsInSummary = Object.keys(categoryData.summary).filter(k => categoryData.summary[k] > 0);
            for (const keyword of keywordsInSummary) {
                const totalCount = categoryData.summary[keyword] || 0;
                const filesDetail = categoryData.details[keyword]
                    ? categoryData.details[keyword].map(d => `${d.file} (${d.count})`).join('; ')
                    : 'N/A';
                detailRows.push([category, keyword, totalCount, `"${filesDetail}"`]);
            }
        }

        // --- Parte 2: Generar la sección de resumen (¡NUEVO!) ---
        const summaryRows = [];
        // Añadimos un par de líneas en blanco para separar las secciones
        summaryRows.push([]);
        summaryRows.push([]);
        summaryRows.push(["--- RESUMEN POR MATERIA ---"]); // Título de la sección
        summaryRows.push(["Materia", "Archivos Analizados", "Total Palabras Clave Encontradas", "Palabra Más Frecuente (Apariciones)"]);

        for (const category in lastAnalysisData) {
            const categoryData = lastAnalysisData[category];
            const fileCount = categoryData.fileCount;

            let totalWordsFound = 0;
            let mostFrequentWord = 'N/A';
            let maxCount = 0;

            for (const keyword in categoryData.summary) {
                const count = categoryData.summary[keyword];
                totalWordsFound += count;
                if (count > maxCount) {
                    maxCount = count;
                    mostFrequentWord = keyword;
                }
            }

            // Formateamos la palabra más frecuente con su conteo
            const mostFrequentWordWithCount = maxCount > 0 ? `${mostFrequentWord} (${maxCount})` : 'N/A';

            summaryRows.push([category, fileCount, totalWordsFound, mostFrequentWordWithCount]);
        }

        // --- Parte 3: Unir todo y descargar (con el BOM) ---

        // Unimos las filas de detalle y las de resumen
        const allRows = detailRows.concat(summaryRows);

        const csvString = allRows.map(e => e.join(",")).join("\n");
        const bom = "\uFEFF"; // Byte Order Mark para compatibilidad con Excel
        const blob = new Blob([bom + csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "analisis_completo.csv");
        document.body.appendChild(link);
        link.click();

        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });

    // --- LÓGICA PARA EL MODAL DE AYUDA ---
    const openModal = () => {
        helpModal.classList.add('visible');
        document.body.classList.add('modal-open');
    };

    const closeModal = () => {
        helpModal.classList.remove('visible');
        document.body.classList.remove('modal-open');
    };

    openHelpBtn.addEventListener('click', openModal);
    closeModalBtn.addEventListener('click', closeModal);
    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && helpModal.classList.contains('visible')) closeModal();
    });


    const sunIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    const moonIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

    const applyTheme = (theme) => {
        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
            themeToggleBtn.innerHTML = sunIcon;
            themeToggleBtn.setAttribute('aria-label', 'Cambiar a modo claro');
            themeToggleBtn.dataset.tooltip = 'Modo Claro';
        } else {
            document.body.classList.remove('dark-mode');
            themeToggleBtn.innerHTML = moonIcon;
            themeToggleBtn.setAttribute('aria-label', 'Cambiar a modo oscuro');
            themeToggleBtn.dataset.tooltip = 'Modo Oscuro';
        }
    };

    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    });

    // Cargar el tema al iniciar la página
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme) {
        applyTheme(savedTheme);
    } else if (prefersDark) {
        applyTheme('dark');
    } else {
        applyTheme('light'); // Default
    }
    // --- NUEVA SECCIÓN DE CÓDIGO PARA GRÁFICOS ---

    const generateCharts = (analysisData, keywordList) => {
        // Datos pre-calculados para los gráficos globales
        const globalChartData = prepareGlobalChartData(analysisData, keywordList);

        // 1. Crear Gráfico de Barras Total
        createTotalBarChart(globalChartData);

        // 2. Crear Gráfico de Radar
        createRadarChart(globalChartData);

        // 3. Los gráficos de pastel se crean dentro de `displayResults`
    };

    const prepareGlobalChartData = (analysisData, keywordList) => {
        const labels = keywordList.filter(k => {
            // Incluir solo keywords que aparecieron al menos una vez
            return Object.values(analysisData).some(cat => (cat.summary[k] || 0) > 0);
        });

        const totalCounts = labels.map(label => {
            return Object.values(analysisData).reduce((sum, category) => sum + (category.summary[label] || 0), 0);
        });

        const datasets = Object.entries(analysisData).map(([category, data]) => {
            return {
                label: category,
                data: labels.map(label => data.summary[label] || 0),
                // Asignar colores dinámicos
            };
        });

        return { labels, totalCounts, datasets };
    };

    const createTotalBarChart = (globalChartData) => {
        const ctx = document.getElementById('totalBarChart').getContext('2d');
        totalBarChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: globalChartData.labels,
                datasets: [{
                    label: 'Frecuencia Total',
                    data: globalChartData.totalCounts,
                    backgroundColor: 'rgba(151, 73, 235, 0.6)',
                    borderColor: 'rgba(135, 50, 226, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                scales: {
                    y: { beginAtZero: true }
                },
                responsive: true,
                plugins: { legend: { display: false } }
            }
        });
    };

    const createRadarChart = (globalChartData) => {
        const ctx = document.getElementById('radarChart').getContext('2d');

        // Asignar colores a cada dataset para el radar
        const radarColors = [
            'rgba(37, 117, 252, 0.4)', 'rgba(252, 37, 117, 0.4)',
            'rgba(117, 252, 37, 0.4)', 'rgba(252, 117, 37, 0.4)',
            'rgba(37, 252, 117, 0.4)', 'rgba(117, 37, 252, 0.4)'
        ];
        globalChartData.datasets.forEach((ds, index) => {
            ds.backgroundColor = radarColors[index % radarColors.length];
            ds.borderColor = radarColors[index % radarColors.length].replace('0.4', '1');
            ds.borderWidth = 2;
        });

        radarChart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: globalChartData.labels,
                datasets: globalChartData.datasets
            },
            options: {
                responsive: true,
                elements: { line: { borderWidth: 3 } },
                plugins: {
                    legend: { position: 'top' }
                }
            }
        });
    };

    const createPieChartForCategory = (category, categoryData, keywordList) => {
        const canvas = document.getElementById(`pieChart-${category}`);
        if (!canvas) return; // Salir si el canvas no existe

        const ctx = canvas.getContext('2d');
        const labels = keywordList.filter(k => (categoryData.summary[k] || 0) > 0);
        const data = labels.map(l => categoryData.summary[l]);

        // Si no hay datos para esta categoría, no renderizar el gráfico
        if (data.length === 0) {
            canvas.parentElement.innerHTML += '<p class="no-chart-data">No se encontraron palabras clave para graficar en esta categoría.</p>';
            canvas.remove();
            return;
        }

        pieCharts[category] = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Proporción de Palabras',
                    data: data,
                    backgroundColor: [
                        'rgba(106, 17, 203, 0.7)', 'rgba(37, 117, 252, 0.7)',
                        'rgba(255, 99, 132, 0.7)', 'rgba(75, 192, 192, 0.7)',
                        'rgba(255, 206, 86, 0.7)', 'rgba(153, 102, 255, 0.7)'
                    ],
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                    }
                }
            }
        });
    };
    toggleWidthBtn.addEventListener('click', () => {
        // Alterna la clase 'expanded' en el contenedor de resultados
        resultsArea.classList.toggle('expanded');

        // Comprueba si ahora está en modo expandido para cambiar el icono y el tooltip
        if (resultsArea.classList.contains('expanded')) {
            toggleWidthBtn.innerHTML = contractIcon;
            toggleWidthBtn.dataset.tooltip = "Contraer Vista";
            toggleWidthBtn.setAttribute('aria-label', "Contraer vista de resultados");
        } else {
            toggleWidthBtn.innerHTML = expandIcon;
            toggleWidthBtn.dataset.tooltip = "Expandir Vista";
            toggleWidthBtn.setAttribute('aria-label', "Expandir vista de resultados");
        }
    });
});