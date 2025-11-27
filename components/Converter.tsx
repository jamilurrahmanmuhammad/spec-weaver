import React, { useState, useRef } from 'react';
import { 
  ArrowRightLeft, 
  FileText, 
  Code2, 
  Download, 
  Settings2, 
  Play, 
  Copy, 
  Check, 
  Trash2,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';
import { Button } from './ui/Button';
import { generateConversionStream, validateSpecFidelity, generateDocxBlob } from '../services/geminiService';
import { ConversionMode, ConversionOptions, SpecFormat, Tone } from '../types';

const INITIAL_OPTIONS: ConversionOptions = {
  includeExamples: true,
  includeAuthentication: true,
  targetAudience: "Developers",
  tone: Tone.TECHNICAL,
  outputFormat: SpecFormat.YAML,
};

export const Converter: React.FC = () => {
  const [mode, setMode] = useState<ConversionMode>(ConversionMode.SPEC_TO_DOC);
  const [inputContent, setInputContent] = useState('');
  const [outputContent, setOutputContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [options, setOptions] = useState<ConversionOptions>(INITIAL_OPTIONS);
  const [showOptions, setShowOptions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);
  
  // Validation State
  const [validationReport, setValidationReport] = useState<{score: number, report: string[]} | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  const outputRef = useRef<HTMLDivElement>(null);

  const handleModeToggle = () => {
    setMode(prev => prev === ConversionMode.SPEC_TO_DOC ? ConversionMode.DOC_TO_SPEC : ConversionMode.SPEC_TO_DOC);
    setInputContent('');
    setOutputContent('');
    setShowSource(false);
    setValidationReport(null);
  };

  const handleGenerate = async () => {
    if (!inputContent.trim()) return;
    setIsGenerating(true);
    setOutputContent('');
    setValidationReport(null);
    setShowSource(false);

    try {
      const stream = generateConversionStream(inputContent, mode, options);
      for await (const chunk of stream) {
        setOutputContent(prev => prev + chunk);
      }
    } catch (error) {
      console.error("Error generating content:", error);
      setOutputContent("Error: Failed to generate content.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleValidation = () => {
      if (!inputContent.trim() || mode !== ConversionMode.SPEC_TO_DOC) return;
      const result = validateSpecFidelity(inputContent, options);
      setValidationReport(result);
      setShowValidation(true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(outputContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    if (!outputContent && mode === ConversionMode.DOC_TO_SPEC) return;
    if (!inputContent && mode === ConversionMode.SPEC_TO_DOC) return;

    let blob: Blob;
    let filename: string;

    if (mode === ConversionMode.SPEC_TO_DOC) {
      // Generate Real DOCX on download
      blob = await generateDocxBlob(inputContent, options);
      filename = 'documentation.docx';
    } else {
      const type = options.outputFormat === SpecFormat.JSON ? 'application/json' : 'text/yaml';
      blob = new Blob([outputContent], { type });
      filename = `openapi-spec.${options.outputFormat.toLowerCase()}`;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getPreviewHtml = (fullHtml: string) => {
    const match = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return match ? match[1] : fullHtml;
  };

  const loadSample = () => {
    if (mode === ConversionMode.SPEC_TO_DOC) {
      setInputContent(`openapi: 3.0.0
info:
  title: Sample User API
  version: 1.0.0
components:
  schemas:
    User:
      type: object
      properties:
        id: { type: integer }
        name: { type: string }
paths:
  /users:
    get:
      operationId: getUsers
      summary: List users
      responses:
        '200':
          content:
            application/json:
              schema:
                type: array
                items: 
                  $ref: '#/components/schemas/User'`);
    } else {
      setInputContent("Paste generated HTML Source here...");
    }
  };

  return (
    <div className="flex flex-col h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Validation Modal */}
      {showValidation && validationReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 animate-in zoom-in-95">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        {validationReport.score === 100 ? <ShieldCheck className="text-green-600"/> : <AlertTriangle className="text-amber-500"/>}
                        Fidelity Report
                    </h3>
                    <button onClick={() => setShowValidation(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                
                <div className="mb-6 text-center">
                    <div className="text-4xl font-black text-slate-800 mb-1">{validationReport.score}%</div>
                    <div className="text-sm text-slate-500 uppercase tracking-wide font-medium">Fidelity Score</div>
                </div>

                <div className="bg-slate-50 rounded-lg p-4 max-h-60 overflow-y-auto border border-slate-200">
                    {validationReport.report.length === 0 ? (
                        <div className="text-green-600 flex items-center gap-2">
                            <Check size={16} /> No discrepancies found. Perfect round-trip!
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {validationReport.report.map((item, idx) => (
                                <li key={idx} className="text-sm text-red-600 flex items-start gap-2">
                                    <span className="mt-1 block h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0"></span>
                                    {item}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="mt-6 flex justify-end">
                    <Button onClick={() => setShowValidation(false)}>Close</Button>
                </div>
            </div>
        </div>
      )}

      {/* Header Controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        
        <div className="flex items-center space-x-4 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => mode !== ConversionMode.SPEC_TO_DOC && handleModeToggle()}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === ConversionMode.SPEC_TO_DOC 
                ? 'bg-white text-indigo-600 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Code2 size={18} />
            <span>Spec to Doc</span>
          </button>
          <button
            onClick={() => mode !== ConversionMode.DOC_TO_SPEC && handleModeToggle()}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === ConversionMode.DOC_TO_SPEC 
                ? 'bg-white text-indigo-600 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileText size={18} />
            <span>Doc to Spec</span>
          </button>
        </div>

        <div className="flex items-center space-x-3">
           <Button variant="ghost" onClick={loadSample} title="Load Sample Data">Sample</Button>

           {mode === ConversionMode.SPEC_TO_DOC && (
               <Button 
                 variant="outline" 
                 icon={<ShieldCheck size={16}/>}
                 onClick={handleValidation}
                 disabled={!inputContent.trim()}
                 title="Verify that generated doc can be perfectly converted back"
               >
                 Check Fidelity
               </Button>
           )}

          <div className="relative">
            <Button variant="outline" icon={<Settings2 size={18} />} onClick={() => setShowOptions(!showOptions)}>Options</Button>
            {showOptions && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 z-50 p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
                <h3 className="font-semibold text-slate-900 mb-2">Configuration</h3>
                {mode === ConversionMode.DOC_TO_SPEC && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase mb-1">Output Format</label>
                    <div className="flex bg-slate-100 rounded-lg p-1">
                      {[SpecFormat.YAML, SpecFormat.JSON].map(fmt => (
                        <button
                          key={fmt}
                          onClick={() => setOptions({...options, outputFormat: fmt})}
                          className={`flex-1 text-xs py-1 rounded-md font-medium transition-all ${
                            options.outputFormat === fmt ? 'bg-white shadow text-indigo-600' : 'text-slate-500'
                          }`}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <Button 
            variant="primary" 
            onClick={handleGenerate}
            isLoading={isGenerating}
            icon={<Play size={18} />}
          >
            Generate
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[500px]">
        <div className="flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
            <span className="font-medium text-slate-700 flex items-center gap-2">
              {mode === ConversionMode.SPEC_TO_DOC ? <Code2 size={18}/> : <FileText size={18}/>}
              {mode === ConversionMode.SPEC_TO_DOC ? "OpenAPI Specification" : "Doc Source (HTML)"}
            </span>
            <button onClick={() => setInputContent('')} className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
          </div>
          <div className="flex-1 relative">
            <textarea
              value={inputContent}
              onChange={(e) => setInputContent(e.target.value)}
              placeholder={mode === ConversionMode.SPEC_TO_DOC ? "Paste YAML/JSON here..." : "Paste the HTML Source code from a previously generated document..."}
              className="absolute inset-0 w-full h-full p-4 resize-none focus:ring-0 focus:outline-none font-mono text-sm text-slate-800"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
            <span className="font-medium text-slate-700 flex items-center gap-2">
              {mode === ConversionMode.SPEC_TO_DOC ? <FileText size={18}/> : <Code2 size={18}/>}
              Output
            </span>
            
            <div className="flex items-center space-x-2">
              {outputContent && (
                <>
                  {mode === ConversionMode.SPEC_TO_DOC && (
                      <button 
                        onClick={() => setShowSource(!showSource)}
                        className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 ${showSource ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-200'}`}
                        title={showSource ? "View Preview" : "View XML Source"}
                      >
                         {showSource ? <Eye size={18} /> : <EyeOff size={18} />}
                      </button>
                  )}
                  <button onClick={handleCopy} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-lg transition-colors" title="Copy to Clipboard">
                    {copied ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                  </button>
                  <button onClick={handleDownload} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-lg transition-colors" title="Download (.docx)">
                    <Download size={18} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div ref={outputRef} className="flex-1 relative bg-slate-50/50 overflow-auto">
            {outputContent ? (
              <div className="p-6 prose prose-indigo max-w-none">
                {mode === ConversionMode.SPEC_TO_DOC ? (
                  showSource ? (
                    <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto text-xs font-mono">{outputContent}</pre>
                  ) : (
                    <div dangerouslySetInnerHTML={{ __html: getPreviewHtml(outputContent) }} />
                  )
                ) : (
                  <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto text-sm"><code>{outputContent}</code></pre>
                )}
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                  <ArrowRightLeft size={48} className="mb-4 opacity-20" />
                  <span className="text-sm">Output will appear here</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};