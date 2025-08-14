document.addEventListener('DOMContentLoaded', () => {
    // --- Selección de Elementos del DOM ---
    const fileInput = document.getElementById('file-input');
    const fileNameDisplay = document.getElementById('file-name-display');
    const folderInfo = document.getElementById('folder-info');
    const searchBtn = document.getElementById('search-btn');
    const searchBtnText = document.querySelector('#search-btn .btn-text');
    const loader = document.querySelector('#search-btn .loader');
    const statusMessage = document.getElementById('status-message');
    const errorMessage = document.getElementById('error-message');
    const resultsArea = document.getElementById('results-area');
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

    let selectedFiles = [];
    let lastAnalysisData = null;

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
        hideMessages();
        resultsArea.classList.add('hidden');
        resultsContainer.innerHTML = '';
        finalSummaryContainer.innerHTML = '';
        lastAnalysisData = null;

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

        const textLower = text.toLowerCase();
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
                        if (!data[category].details[keyword]) {
                            data[category].details[keyword] = [];
                        }
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
            resultsContainer.innerHTML = '<p>No se encontraron resultados para las carpetas seleccionadas.</p>';
            return;
        }

        for (const category in analysisData) {
            const categoryData = analysisData[category];
            const section = document.createElement('section');
            section.className = 'category-section';

            let tableHtml = `
                <h2 class="category-header">${category} (${categoryData.fileCount} archivos)</h2>
                <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 20px;"></th>
                                <th>Palabra Clave</th>
                                <th>Total Apariciones</th>
                            </tr>
                        </thead>
                        <tbody>`;

            keywordList.forEach(keyword => {
                const totalCount = categoryData.summary[keyword] || 0;
                const details = categoryData.details[keyword];
                if (totalCount > 0) {
                    tableHtml += `<tr class="parent-row" data-keyword="${keyword}"><td><span class="toggle-icon">▸</span></td><td>${keyword}</td><td>${totalCount}</td></tr>`;
                    if (details) {
                        details.sort((a,b) => b.count - a.count).forEach(item => {
                            tableHtml += `<tr class="detail-row hidden" data-parent-keyword="${keyword}"><td></td><td class="file-name-cell">${item.file}</td><td>${item.count}</td></tr>`;
                        });
                    }
                }
            });
            tableHtml += `</tbody></table></div>`;
            section.innerHTML = tableHtml;
            resultsContainer.appendChild(section);
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
            alert("No hay datos para guardar. Realiza un análisis primero.");
            return;
        }

        const rows = [["Categoria", "Palabra Clave", "Total Apariciones", "Archivos con la Palabra (cantidad)"]];
        for (const category in lastAnalysisData) {
            const categoryData = lastAnalysisData[category];
            const keywordsInSummary = Object.keys(categoryData.summary).filter(k => categoryData.summary[k] > 0);
            for (const keyword of keywordsInSummary) {
                const totalCount = categoryData.summary[keyword] || 0;
                const filesDetail = categoryData.details[keyword] ? categoryData.details[keyword].map(d => `${d.file} (${d.count})`).join('; ') : 'N/A';
                rows.push([category, keyword, totalCount, `"${filesDetail}"`]);
            }
        }
        
        let csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "analisis_comparativo.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
});