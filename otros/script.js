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
    
    // Elementos del nuevo layout
    const placeholder = document.getElementById('placeholder');
    const resultsArea = document.getElementById('results-area');
    
    const resultsContainer = document.getElementById('results-container');
    const saveCsvBtn = document.getElementById('save-csv-btn');
    const finalSummaryContainer = document.getElementById('final-summary-container');

    const tagContainer = document.getElementById('tag-container');
    const keywordsInputField = document.getElementById('keywords-input-field');

    const openHelpBtn = document.getElementById('openHelpBtn');
    const helpModal = document.getElementById('helpModal');
    const closeModalBtn = document.getElementById('closeModalBtn');

    let lastAnalysisData = null;
    let totalBarChart = null;
    let radarChart = null;
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
        const selectedFiles = Array.from(fileInput.files);
        if (selectedFiles.length > 0) {
            const rootFolderName = selectedFiles[0].webkitRelativePath.split('/')[0];
            fileNameDisplay.innerHTML = `Carpeta: <strong>${rootFolderName}</strong>`;
            const supportedFiles = selectedFiles.filter(f => /\.(pdf|docx|pptx)$/i.test(f.name));
            folderInfo.textContent = `${supportedFiles.length} archivos compatibles.`;
        } else {
            fileNameDisplay.innerHTML = `<strong>Haz clic para seleccionar carpeta</strong>`;
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
        hideMessages();
        // Ocultar resultados y mostrar placeholder al iniciar
        resultsArea.classList.add('hidden');
        placeholder.classList.remove('hidden'); 
        
        resultsContainer.innerHTML = '';
        finalSummaryContainer.innerHTML = '';
        lastAnalysisData = null;

        if (totalBarChart) totalBarChart.destroy();
        if (radarChart) radarChart.destroy();
        Object.values(pieCharts).forEach(chart => chart.destroy());
        pieCharts = {};

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

        showLoader(true);
        const supportedFiles = selectedFiles.filter(f => /\.(pdf|docx|pptx)$/i.test(f.name));
        if (supportedFiles.length === 0) {
            showLoader(false);
            showMessage(errorMessage, 'La carpeta no contiene archivos compatibles (.pdf, .docx, .pptx).');
            return;
        }
        showMessage(statusMessage, `Procesando ${supportedFiles.length} archivos...`);

        const processingPromises = supportedFiles.map(file => processFile(file, keywordList));
        const results = await Promise.allSettled(processingPromises);
        const analysisData = aggregateResults(results);
        lastAnalysisData = analysisData;

        displayResults(analysisData, keywordList);
        generateFinalSummary(analysisData, keywordList);
        generateCharts(analysisData, keywordList);

        // Ocultar placeholder y mostrar resultados al finalizar
        placeholder.classList.add('hidden');
        resultsArea.classList.remove('hidden');
        
        hideMessages();
        showLoader(false);
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

        let textLower = ' ' + text.toLowerCase().replace(/([.,;:"()\[\]])/g, ' $1 ') + ' ';

        const counts = {};
        keywordList.forEach(keyword => {
            const regex = new RegExp('\\b' + keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'g');
            const matches = textLower.match(regex);
            counts[keyword] = matches ? matches.length : 0;
        });

        return { category, fileName, counts };
    };

    const aggregateResults = (results) => {
        const data = {};
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                const { category, fileName, counts } = result.value;
                if (!data[category]) {
                    data[category] = { summary: {}, details: {}, fileCount: 0, processedFiles: new Set() };
                }
                if (!data[category].processedFiles.has(fileName)) {
                    data[category].fileCount++;
                    data[category].processedFiles.add(fileName);
                }
                for (const [keyword, count] of Object.entries(counts)) {
                    data[category].summary[keyword] = (data[category].summary[keyword] || 0) + count;
                    if (count > 0) {
                        if (!data[category].details[keyword]) data[category].details[keyword] = [];
                        data[category].details[keyword].push({ file: fileName, count });
                    }
                }
            }
        });
        return data;
    };
    
    const displayResults = (analysisData, keywordList) => {
        resultsContainer.innerHTML = '';
        if (Object.keys(analysisData).length === 0) {
            resultsContainer.innerHTML = '<p class="no-results-message">No se encontraron resultados para los archivos y palabras clave proporcionados.</p>';
            return;
        }

        for (const category in analysisData) {
            const categoryData = analysisData[category];
            const section = document.createElement('section');
            section.className = 'category-section';

            let tableHtml = `<div class="table-wrapper"><table><thead><tr><th style="width: 20px;"></th><th>Palabra Clave</th><th>Total</th></tr></thead><tbody>`;

            keywordList.forEach(keyword => {
                const totalCount = categoryData.summary[keyword] || 0;
                const details = categoryData.details[keyword];
                if (totalCount > 0) {
                    tableHtml += `<tr class="parent-row" data-keyword="${keyword}"><td><span class="toggle-icon">▸</span></td><td>${keyword}</td><td>${totalCount}</td></tr>`;
                    if (details) {
                        details.sort((a, b) => b.count - a.count).forEach(item => {
                            tableHtml += `<tr class="detail-row hidden" data-parent-keyword="${keyword}"><td class="file-name-cell" colspan="2">${item.file}</td><td>${item.count}</td></tr>`;
                        });
                    }
                }
            });
            tableHtml += `</tbody></table></div>`;

            section.innerHTML = `
                <h2 class="category-header">${category} (${categoryData.fileCount} archivos)</h2>
                <div class="category-content-grid">
                    <div class="table-container">${tableHtml}</div>
                    <div class="chart-container">
                        <h3>Proporción por Palabra</h3>
                        <canvas id="pieChart-${category}"></canvas>
                    </div>
                </div>`;
            
            resultsContainer.appendChild(section);
            createPieChartForCategory(category, categoryData, keywordList);
        }
    };

    resultsContainer.addEventListener('click', (e) => {
        const parentRow = e.target.closest('.parent-row');
        if (!parentRow) return;

        const keyword = parentRow.dataset.keyword;
        const detailRows = parentRow.closest('tbody').querySelectorAll(`.detail-row[data-parent-keyword="${keyword}"]`);
        const icon = parentRow.querySelector('.toggle-icon');
        
        const areHidden = Array.from(detailRows).some(row => row.classList.contains('hidden'));
        
        detailRows.forEach(row => row.classList.toggle('hidden', !areHidden));
        icon.textContent = areHidden ? '▾' : '▸';
        parentRow.classList.toggle('expanded', areHidden);
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
            finalSummaryContainer.innerHTML = '<p>No se encontraron las palabras clave en ningún documento.</p>';
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
            alert("No hay datos de análisis para guardar.");
            return;
        }
        
        const detailRows = [["Categoria", "Palabra Clave", "Total Apariciones", "Archivos con la Palabra (cantidad)"]];
        for (const category in lastAnalysisData) {
            const categoryData = lastAnalysisData[category];
            const keywordsInSummary = Object.keys(categoryData.summary).filter(k => categoryData.summary[k] > 0);
            for (const keyword of keywordsInSummary) {
                const totalCount = categoryData.summary[keyword] || 0;
                const filesDetail = categoryData.details[keyword] ? categoryData.details[keyword].map(d => `${d.file} (${d.count})`).join('; ') : 'N/A';
                detailRows.push([category, keyword, totalCount, `"${filesDetail}"`]);
            }
        }

        const summaryRows = [[], [], ["--- RESUMEN POR MATERIA ---"], ["Materia", "Archivos Analizados", "Total Palabras Clave Encontradas", "Palabra Más Frecuente (Apariciones)"]];
        for (const category in lastAnalysisData) {
            const categoryData = lastAnalysisData[category];
            let totalWordsFound = 0, mostFrequentWord = 'N/A', maxCount = 0;
            for (const keyword in categoryData.summary) {
                const count = categoryData.summary[keyword];
                totalWordsFound += count;
                if (count > maxCount) { maxCount = count; mostFrequentWord = keyword; }
            }
            const mostFrequentWordWithCount = maxCount > 0 ? `${mostFrequentWord} (${maxCount})` : 'N/A';
            summaryRows.push([category, categoryData.fileCount, totalWordsFound, mostFrequentWordWithCount]);
        }

        const csvString = detailRows.concat(summaryRows).map(e => e.join(",")).join("\n");
        const blob = new Blob(["\uFEFF" + csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "analisis_completo.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // --- MODAL, TEMA Y GRÁFICOS (SIN CAMBIOS EN LÓGICA) ---
    const openModal = () => helpModal.classList.add('visible');
    const closeModal = () => helpModal.classList.remove('visible');
    openHelpBtn.addEventListener('click', openModal);
    closeModalBtn.addEventListener('click', closeModal);
    helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    const sunIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    const moonIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
    const applyTheme = (theme) => {
        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
            themeToggleBtn.innerHTML = sunIcon;
            themeToggleBtn.dataset.tooltip = 'Modo Claro';
        } else {
            document.body.classList.remove('dark-mode');
            themeToggleBtn.innerHTML = moonIcon;
            themeToggleBtn.dataset.tooltip = 'Modo Oscuro';
        }
    };
    themeToggleBtn.addEventListener('click', () => {
        const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    });
    const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(savedTheme);
    
    const generateCharts = (analysisData, keywordList) => {
        const globalChartData = prepareGlobalChartData(analysisData, keywordList);
        createTotalBarChart(globalChartData);
        createRadarChart(globalChartData);
    };
    const prepareGlobalChartData = (analysisData, keywordList) => {
        const labels = keywordList.filter(k => Object.values(analysisData).some(cat => (cat.summary[k] || 0) > 0));
        const totalCounts = labels.map(label => Object.values(analysisData).reduce((sum, category) => sum + (category.summary[label] || 0), 0));
        const datasets = Object.entries(analysisData).map(([category, data]) => ({
            label: category,
            data: labels.map(label => data.summary[label] || 0),
        }));
        return { labels, totalCounts, datasets };
    };
    const createTotalBarChart = (globalChartData) => {
        const ctx = document.getElementById('totalBarChart').getContext('2d');
        totalBarChart = new Chart(ctx, {
            type: 'bar',
            data: { labels: globalChartData.labels, datasets: [{ label: 'Frecuencia Total', data: globalChartData.totalCounts, backgroundColor: 'rgba(106, 17, 203, 0.6)', borderColor: 'rgba(106, 17, 203, 1)', borderWidth: 1 }] },
            options: { scales: { y: { beginAtZero: true } }, responsive: true, plugins: { legend: { display: false } } }
        });
    };
    const createRadarChart = (globalChartData) => {
        const ctx = document.getElementById('radarChart').getContext('2d');
        const radarColors = ['rgba(37, 117, 252, 0.4)', 'rgba(252, 37, 117, 0.4)', 'rgba(117, 252, 37, 0.4)', 'rgba(252, 117, 37, 0.4)', 'rgba(37, 252, 117, 0.4)', 'rgba(117, 37, 252, 0.4)'];
        globalChartData.datasets.forEach((ds, index) => {
            ds.backgroundColor = radarColors[index % radarColors.length];
            ds.borderColor = ds.backgroundColor.replace('0.4', '1');
            ds.borderWidth = 2;
        });
        radarChart = new Chart(ctx, {
            type: 'radar',
            data: { labels: globalChartData.labels, datasets: globalChartData.datasets },
            options: { responsive: true, elements: { line: { borderWidth: 3 } }, plugins: { legend: { position: 'top' } } }
        });
    };
    const createPieChartForCategory = (category, categoryData, keywordList) => {
        const canvas = document.getElementById(`pieChart-${category}`);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const labels = keywordList.filter(k => (categoryData.summary[k] || 0) > 0);
        const data = labels.map(l => categoryData.summary[l]);
        if (data.length === 0) {
            canvas.parentElement.innerHTML += '<p class="no-chart-data">No se encontraron datos.</p>';
            canvas.remove();
            return;
        }
        pieCharts[category] = new Chart(ctx, {
            type: 'pie',
            data: { labels: labels, datasets: [{ label: 'Proporción', data: data, backgroundColor: ['rgba(106, 17, 203, 0.7)', 'rgba(37, 117, 252, 0.7)', 'rgba(255, 99, 132, 0.7)', 'rgba(75, 192, 192, 0.7)', 'rgba(255, 206, 86, 0.7)', 'rgba(153, 102, 255, 0.7)'], hoverOffset: 4 }] },
            options: { responsive: true, plugins: { legend: { position: 'top' } } }
        });
    };
});