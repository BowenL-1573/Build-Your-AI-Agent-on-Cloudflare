import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Zap, Plus, LogOut, Play, CheckCircle, Clock, AlertCircle,
  Terminal, Globe, X, Send, Loader2, Trash2, RefreshCw,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { API_BASE, WS_BASE } from '@/lib/api';

interface Task {
  id: string;
  name: string;
  description: string;
  status: 'running' | 'completed' | 'failed' | 'waiting_approval';
  progress: number;
  createdAt: string;
  logs: string[];
  screenshots: string[];
  plan?: { id: number; description: string; status: string }[];
  pendingApproval?: { message: string; workflowId: string; timeout?: number; startTime?: number };
}

function getToken() { return localStorage.getItem('token') || ''; }
function getUsername(): string {
  try { const [, u] = atob(getToken()).split(':'); return u || 'User'; } catch { return 'User'; }
}

function CountdownTimer({ startTime, timeout, onExpire }: { startTime: number; timeout: number; onExpire: () => void }) {
  const [remaining, setRemaining] = useState(Math.max(0, timeout - Math.floor((Date.now() - startTime) / 1000)));
  useEffect(() => {
    if (remaining <= 0) { onExpire(); return; }
    const timer = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return <span className="text-yellow-400 font-mono">{remaining}s</span>;
}

// --- API helpers ---
async function fetchTasks(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/api/tasks?token=${getToken()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.tasks || [];
}

async function fetchTaskDetail(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/tasks/${id}?token=${getToken()}`);
  if (!res.ok) return null;
  return res.json();
}

async function deleteTask(id: string) {
  await fetch(`${API_BASE}/api/tasks/${id}?token=${getToken()}`, { method: 'DELETE' });
}

// --- Sidebar ---
const Sidebar = ({ username }: { username: string }) => (
  <div className="w-64 h-screen glass-strong border-r border-white/5 flex flex-col fixed left-0 top-0">
    <div className="p-6 border-b border-white/5">
      <Link to="/" className="flex items-center gap-3" data-track="sidebar-logo">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
          <Zap className="w-5 h-5 text-white" />
        </div>
        <span className="text-xl font-bold text-white">Agents</span>
      </Link>
    </div>
    <nav className="flex-1 p-4 space-y-2">
      <div className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30">
        <Terminal className="w-5 h-5" /><span>任务中心</span>
      </div>
    </nav>
    <div className="p-4 border-t border-white/5">
      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-semibold">
          {username.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0"><div className="text-white font-medium truncate">{username}</div></div>
        <Link to="/" data-track="sidebar-logout"><LogOut className="w-5 h-5 text-gray-400 hover:text-white cursor-pointer" /></Link>
      </div>
    </div>
  </div>
);

// --- New Task Modal ---
const NewTaskModal = ({ isOpen, onClose, onCreate }: {
  isOpen: boolean; onClose: () => void; onCreate: (t: Partial<Task>) => void;
}) => {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && ref.current) gsap.fromTo(ref.current, { opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'expo.out' });
  }, [isOpen]);

  if (!isOpen) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    onCreate({ name, description: desc });
    setName(''); setDesc(''); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} className="relative w-full max-w-lg glass-strong rounded-2xl border border-white/10 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">创建新任务</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5" data-track="new-task-modal-close"><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <form onSubmit={submit} className="space-y-6">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
              <Globe className="w-5 h-5 text-white" />
            </div>
            <div><div className="text-white font-medium">Web Research Agent</div><div className="text-xs text-gray-500">网页信息收集与分析</div></div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">任务名称</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="例如：总结 HN AI 新闻" className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 rounded-xl" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">任务描述</label>
              <Textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="描述您希望 Agent 完成的研究任务..." className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 rounded-xl min-h-[100px]" />
            </div>
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 border-white/10 text-white hover:bg-white/5" data-track="new-task-cancel">取消</Button>
            <Button type="submit" disabled={!name} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50" data-track="new-task-start"><Play className="w-4 h-4 mr-2" />开始任务</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Task Card ---
const TaskCard = ({ task, onClick, onDelete }: { task: Task; onClick: () => void; onDelete: () => void }) => {
  const colors: Record<string, string> = {
    running: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    completed: 'text-green-400 bg-green-500/10 border-green-500/30',
    failed: 'text-red-400 bg-red-500/10 border-red-500/30',
  };
  const icons: Record<string, any> = { running: Loader2, completed: CheckCircle, failed: AlertCircle };
  const labels: Record<string, string> = { running: '运行中', completed: '已完成', failed: '失败' };
  const Icon = icons[task.status] || Clock;

  return (
    <div className="p-5 rounded-xl glass border border-white/5 hover:border-purple-500/30 transition-all duration-300 cursor-pointer group relative">
      <button onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-all"
        data-track="task-delete">
        <Trash2 className="w-4 h-4 text-red-400" />
      </button>
      <div onClick={onClick}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`p-2 rounded-lg ${colors[task.status] || ''}`}>
            <Icon className={`w-4 h-4 ${task.status === 'running' ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <h3 className="text-white font-medium group-hover:text-purple-400 transition-colors">{task.name}</h3>
            <p className="text-xs text-gray-500">{labels[task.status]}</p>
          </div>
        </div>
        <p className="text-gray-400 text-sm mb-3 line-clamp-2">{task.description}</p>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{task.createdAt}</span>
          <span>{task.logs.length} 条日志</span>
        </div>
      </div>
    </div>
  );
};

// --- Task Detail Panel ---
const TaskDetailPanel = ({ task, onClose, tasks, onSendMessage, onUpdateTask, taskWsMap }: {
  task: Task | null; onClose: () => void; tasks: Task[]; onSendMessage: (id: string, msg: string) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void; taskWsMap: Map<string, WebSocket>;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const logsEnd = useRef<HTMLDivElement>(null);
  const live = task ? tasks.find(t => t.id === task.id) || task : null;

  useEffect(() => {
    if (live && ref.current) gsap.fromTo(ref.current, { x: '100%' }, { x: 0, duration: 0.5, ease: 'expo.out' });
  }, [live?.id]);

  // Load logs from DO for history tasks
  useEffect(() => {
    if (live && live.logs.length === 0 && live.status !== 'running') {
      fetchTaskDetail(live.id).then(data => {
        if (!data) return;
        const token = getToken();
        const logs = (data.logs || []).map((l: string) =>
          l.startsWith('[screenshot]') ? `[screenshot]${l.slice(12)}${l.slice(12).includes('?') ? '&' : '?'}token=${token}` : l
        );
        onUpdateTask(live.id, { logs, plan: data.plan || undefined });
      });
    }
  }, [live?.id]);

  useEffect(() => { logsEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [live?.logs.length]);

  if (!live) return null;

  const send = () => { if (!message.trim()) return; onSendMessage(live.id, message); setMessage(''); };

  return (
    <div ref={ref} className="fixed right-0 top-0 h-full w-[58%] glass-strong border-l border-white/5 z-40 flex flex-col" style={{ transform: 'translateX(100%)' }}>
      <div className="h-14 border-b border-white/5 flex items-center justify-between px-6 shrink-0">
        <h3 className="text-lg font-semibold text-white">任务详情</h3>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5" data-track="task-detail-close"><X className="w-5 h-5 text-gray-400" /></button>
      </div>

      {/* Fixed: title + plan + progress */}
      <div className="shrink-0 p-6 pb-3 space-y-4 border-b border-white/5">
        <h2 className="text-xl font-bold text-white">{live.name}</h2>

        {live.plan && live.plan.length > 0 && (
          <div className="p-3 rounded-xl bg-white/5 space-y-1.5">
            <h4 className="text-sm font-medium text-purple-400 mb-1">📋 执行计划</h4>
            {live.plan.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <span>{s.status === 'done' ? '✅' : s.status === 'running' ? '▶️' : s.status === 'failed' ? '❌' : '⬜'}</span>
                <span className={s.status === 'done' ? 'text-green-400' : s.status === 'running' ? 'text-blue-400' : 'text-gray-400'}>
                  {s.id}. {s.description}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="p-3 rounded-xl bg-white/5">
          <div className="flex items-center gap-2">
            {live.status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
            {live.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-400" />}
            {live.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-400" />}
            {live.status === 'waiting_approval' && <Clock className="w-4 h-4 text-yellow-400" />}
            <span className={live.status === 'running' ? 'text-blue-400' : live.status === 'completed' ? 'text-green-400' : live.status === 'waiting_approval' ? 'text-yellow-400' : 'text-red-400'}>
              {live.status === 'running' ? '运行中' : live.status === 'completed' ? '已完成' : live.status === 'waiting_approval' ? '等待确认' : '失败'}
            </span>
            <span className="ml-auto text-white font-medium">{Math.round(live.progress)}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden mt-2">
            <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500" style={{ width: `${live.progress}%` }} />
          </div>
        </div>

        {live.pendingApproval && (
          <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 space-y-3">
            <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
              <AlertCircle className="w-4 h-4" />{live.pendingApproval.timeout ? '确认计划' : '需要确认'}
              {live.pendingApproval.timeout && live.pendingApproval.startTime && (
                <CountdownTimer startTime={live.pendingApproval.startTime} timeout={live.pendingApproval.timeout} onExpire={() => {
                  const ws = taskWsMap.get(live.id); ws?.send(JSON.stringify({ type: 'approve', userInput: '' }));
                  onUpdateTask(live.id, { status: 'running', pendingApproval: undefined, logs: [...live.logs, '⏱️ 超时自动执行'] });
                }} />
              )}
            </div>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{live.pendingApproval.message}</p>
            <textarea id={`help-input-${live.id}`} placeholder="输入建议或指导（可选）..." rows={2}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg p-2 text-sm text-gray-200 placeholder-gray-500 focus:border-yellow-500 focus:outline-none" />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { const ws = taskWsMap.get(live.id);
                ws?.send(JSON.stringify({ type: 'approve', userInput: '' }));
                onUpdateTask(live.id, { status: 'running', pendingApproval: undefined, logs: [...live.logs, '✅ 确认执行'] }); }}
                className="bg-green-600 hover:bg-green-700 text-white text-xs"
                data-track="task-approve-execute">
                <CheckCircle className="w-3 h-3 mr-1" />确认执行
              </Button>
              <Button size="sm" onClick={() => { const ws = taskWsMap.get(live.id); const input = (document.getElementById(`help-input-${live.id}`) as HTMLTextAreaElement)?.value || '';
                if (!input.trim()) return alert('请先输入修改建议');
                ws?.send(JSON.stringify({ type: 'approve', userInput: input }));
                onUpdateTask(live.id, { status: 'running', pendingApproval: undefined, logs: [...live.logs, `🔄 修改建议: ${input}`] }); }}
                className="bg-yellow-600 hover:bg-yellow-700 text-white text-xs"
                data-track="task-approve-modify">
                <RefreshCw className="w-3 h-3 mr-1" />修改计划
              </Button>
              <Button size="sm" variant="outline" onClick={() => { const ws = taskWsMap.get(live.id); ws?.send(JSON.stringify({ type: 'reject', reason: '用户拒绝' }));
                onUpdateTask(live.id, { status: 'failed', pendingApproval: undefined, logs: [...live.logs, '❌ 已拒绝'] }); }}
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs"
                data-track="task-approve-reject">
                <X className="w-3 h-3 mr-1" />终止任务
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Scrollable: logs */}
      <div className="flex-1 overflow-y-auto p-6 pt-3">
        <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2"><Terminal className="w-4 h-4" />执行日志</h4>
        <div className="space-y-2">
            {live.logs.map((log, i) => {
              // Screenshot log: render as thumbnail
              if (log.startsWith('[screenshot]')) {
                const imgUrl = log.slice(12);
                return (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/5">
                    <span className="text-xs text-gray-500 mt-0.5">{i + 1}</span>
                    <div>
                      <span className="text-sm text-gray-400">截图</span>
                      <img src={imgUrl} alt="screenshot" onClick={() => setLightbox(imgUrl)}
                        className="mt-2 rounded-lg border border-white/10 max-w-[280px] cursor-pointer hover:border-purple-500/50 transition-colors"
                        data-track="task-screenshot-view" />
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/5">
                  <span className="text-xs text-gray-500 mt-0.5">{i + 1}</span>
                  <span className="text-sm text-gray-300 whitespace-pre-wrap break-words">{log}</span>
                </div>
              );
            })}
            <div ref={logsEnd} />
          </div>
        </div>

      {/* Lightbox */}
      {lightbox && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4 cursor-pointer" onClick={() => setLightbox(null)} data-track="task-lightbox-close">
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/10" data-track="task-lightbox-close-button">
            <X className="w-6 h-6 text-white" />
          </button>
          <img src={lightbox} alt="screenshot" className="max-w-[90vw] max-h-[90vh] rounded-lg" onClick={e => e.stopPropagation()} />
        </div>,
        document.body
      )}

      <div className="h-16 border-t border-white/5 p-4">
        <div className="flex gap-2">
          <Input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="向 Agent 发送追加指令..." className="flex-1 bg-white/5 border-white/10 text-white placeholder:text-gray-600 rounded-xl" />
          <Button size="icon" onClick={send} className="bg-purple-600 hover:bg-purple-700 rounded-xl" data-track="task-send-message"><Send className="w-4 h-4" /></Button>
        </div>
      </div>
    </div>
  );
};

// --- Main Dashboard ---
const Dashboard = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [taskWsMap] = useState<Map<string, WebSocket>>(new Map());
  const [filter, setFilter] = useState<'all' | 'running' | 'completed'>('all');
  const navigate = useNavigate();
  const username = getUsername();

  useEffect(() => {
    if (!getToken()) { navigate('/login'); return; }
    // Load history tasks from D1
    fetchTasks().then(rows => {
      const history: Task[] = rows.map((r: any) => ({
        id: r.id, name: r.title || '未命名任务', description: '', status: r.status || 'completed',
        progress: r.status === 'completed' ? 100 : r.status === 'failed' ? 100 : 0,
        createdAt: r.created_at || '', logs: [], screenshots: [],
      }));
      setTasks(prev => {
        // Merge: keep live tasks, add history ones that aren't already present
        const liveIds = new Set(prev.map(t => t.id));
        return [...prev, ...history.filter(h => !liveIds.has(h.id))];
      });
    });
  }, [navigate]);

  const connectTask = (task: Task) => {
    const ws = new WebSocket(`${WS_BASE}/ws?token=${getToken()}&task=${task.id}&title=${encodeURIComponent(task.name)}`);
    taskWsMap.set(task.id, ws);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'task', content: task.description, task_id: task.id }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      setTasks(prev => prev.map(t => {
        if (t.id !== task.id) return t;
        switch (msg.type) {
          case 'plan':
            return { ...t, plan: msg.steps, logs: [...t.logs, `📋 计划: ${msg.steps?.map((s: any) => `${s.id}. ${s.description}`).join(' → ')}`] };
          case 'step_start':
            return { ...t, plan: t.plan?.map(s => s.id === msg.step_id ? { ...s, status: 'running' } : s),
              logs: [...t.logs, `▶️ 开始: ${msg.description || `步骤 ${msg.step_id}`}`], progress: Math.min(t.progress + 10, 90) };
          case 'step_done':
            return { ...t, plan: t.plan?.map(s => s.id === msg.step_id ? { ...s, status: 'done' } : s),
              logs: [...t.logs, `✅ 完成: 步骤 ${msg.step_id}`] };
          case 'observation':
            return { ...t, logs: [...t.logs, `📄 ${msg.summary}`] };
          case 'status':
            return { ...t, logs: [...t.logs, msg.message], progress: Math.min(t.progress + 5, 90) };
          case 'reasoning':
            return { ...t, logs: [...t.logs, `🧠 ${msg.content}`] };
          case 'thinking':
            return { ...t, logs: [...t.logs, `💭 ${msg.content}`] };
          case 'action':
            return { ...t, logs: [...t.logs, `🔧 ${msg.tool}: ${JSON.stringify(msg.args)}`] };
          case 'screenshot': {
            const imgUrl = `${msg.url}${msg.url.includes('?') ? '&' : '?'}token=${getToken()}`;
            return { ...t, screenshots: [...t.screenshots, imgUrl], logs: [...t.logs, `[screenshot]${imgUrl}`] };
          }
          case 'answer':
            return { ...t, status: 'completed', progress: 100, logs: [...t.logs, `✅ ${msg.content}`], pendingApproval: undefined };
          case 'error':
            return { ...t, status: 'failed', progress: 100, logs: [...t.logs, `❌ ${msg.message}`], pendingApproval: undefined };
          case 'approval_required':
            return { ...t, status: 'waiting_approval', pendingApproval: { message: msg.message, workflowId: msg.workflowId },
              logs: [...t.logs, `⏸️ 等待确认: ${msg.message}`] };
          case 'plan_review':
            return { ...t, status: 'waiting_approval', pendingApproval: { message: msg.message, workflowId: msg.workflowId, timeout: msg.timeout || 30, startTime: Date.now() },
              logs: [...t.logs, `⏸️ 确认计划（${msg.timeout || 30}秒后自动执行）`] };
          case 'workflow_complete':
            return { ...t, status: t.status === 'running' ? 'completed' : t.status, progress: 100 };
          default: return t;
        }
      }));
    };

    ws.onerror = () => {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'failed', logs: [...t.logs, '❌ 连接错误'] } : t));
    };
  };

  const handleCreate = (data: Partial<Task>) => {
    const t: Task = {
      id: crypto.randomUUID(), name: data.name || '', description: data.description || '',
      status: 'running', progress: 5, createdAt: '刚刚', logs: [`📝 任务: ${data.description || data.name || ''}`, '⏳ 正在初始化沙盒...'], screenshots: [],
    };
    setTasks(prev => [t, ...prev]);
    setSelectedTask(t);
    connectTask(t);
  };

  const handleDelete = async (id: string) => {
    await deleteTask(id);
    setTasks(prev => prev.filter(t => t.id !== id));
    if (selectedTask?.id === id) setSelectedTask(null);
    const ws = taskWsMap.get(id);
    if (ws) { ws.close(); taskWsMap.delete(id); }
  };

  const handleUpdateTask = (id: string, updates: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleSend = (taskId: string, message: string) => {
    const ws = taskWsMap.get(taskId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'task', content: message, task_id: taskId }));
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, logs: [...t.logs, `📤 ${message}`], status: 'running' } : t));
    }
  };

  const filtered = tasks.filter(t => filter === 'all' || t.status === filter);

  return (
    <div className="min-h-screen bg-black">
      <div className="noise-overlay" />
      <Sidebar username={username} />
      <div className="ml-64">
        <main className="min-h-screen p-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">任务中心</h1>
              <p className="text-gray-500">管理和监控您的 Web Research 任务</p>
            </div>
            <Button onClick={() => setIsNewTaskModalOpen(true)} className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl" data-track="dashboard-new-task">
              <Plus className="w-4 h-4 mr-2" />新建任务
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: '总任务', value: tasks.length, color: 'from-purple-500 to-pink-500' },
              { label: '运行中', value: tasks.filter(t => t.status === 'running').length, color: 'from-blue-500 to-cyan-500' },
              { label: '已完成', value: tasks.filter(t => t.status === 'completed').length, color: 'from-green-500 to-emerald-500' },
            ].map((s, i) => (
              <div key={i} className="p-4 rounded-xl glass border border-white/5">
                <div className={`text-2xl font-bold bg-gradient-to-r ${s.color} bg-clip-text text-transparent`}>{s.value}</div>
                <div className="text-sm text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2 mb-6">
            {(['all', 'running', 'completed'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg text-sm transition-all ${filter === f ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}
                data-track={`dashboard-filter-${f}`}>
                {f === 'all' ? '全部' : f === 'running' ? '运行中' : '已完成'}
              </button>
            ))}
          </div>

          {/* Tasks Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(t => (
              <TaskCard key={t.id} task={t} onClick={() => setSelectedTask(t)} onDelete={() => handleDelete(t.id)} />
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-20">
              <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                <Terminal className="w-8 h-8 text-gray-500" />
              </div>
              <h3 className="text-white font-medium mb-2">暂无任务</h3>
              <p className="text-gray-500 mb-4">创建您的第一个 Web Research 任务</p>
              <Button onClick={() => setIsNewTaskModalOpen(true)} variant="outline" className="border-white/10 text-white hover:bg-white/5" data-track="dashboard-empty-new-task">
                <Plus className="w-4 h-4 mr-2" />新建任务
              </Button>
            </div>
          )}
        </main>
      </div>

      <NewTaskModal isOpen={isNewTaskModalOpen} onClose={() => setIsNewTaskModalOpen(false)} onCreate={handleCreate} />
      <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} tasks={tasks} onSendMessage={handleSend} onUpdateTask={handleUpdateTask} taskWsMap={taskWsMap} />
    </div>
  );
};

export default Dashboard;
