import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Zap, ArrowLeft, Users, ListTodo, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { API_BASE } from '@/lib/api';

function getToken() { return localStorage.getItem('token') || ''; }

interface UserRow { id: string; username: string; role: string; created_at: string }
interface TaskRow { id: string; user_id: string; username: string; title: string; status: string; created_at: string; updated_at: string }
interface TaskDetail { messages: any[]; steps: any[]; plan: any[] | null; logs: string[] }

async function fetchOverview() {
  const res = await fetch(`${API_BASE}/api/admin/overview?token=${getToken()}`);
  if (!res.ok) throw new Error('forbidden');
  return res.json();
}

async function fetchAdminTaskDetail(userId: string, taskId: string): Promise<TaskDetail | null> {
  const res = await fetch(`${API_BASE}/api/admin/task/${userId}/${taskId}?token=${getToken()}`);
  if (!res.ok) return null;
  return res.json();
}

const Admin = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [taskDetails, setTaskDetails] = useState<Record<string, TaskDetail>>({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchOverview();
      setUsers(data.users || []);
      setTasks(data.tasks || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleTask = async (task: TaskRow) => {
    if (expandedTask === task.id) { setExpandedTask(null); return; }
    setExpandedTask(task.id);
    if (!taskDetails[task.id]) {
      const detail = await fetchAdminTaskDetail(task.user_id, task.id);
      if (detail) setTaskDetails(prev => ({ ...prev, [task.id]: detail }));
    }
  };

  const statusColor: Record<string, string> = {
    running: 'text-blue-400 bg-blue-500/10',
    completed: 'text-green-400 bg-green-500/10',
    failed: 'text-red-400 bg-red-500/10',
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="noise-overlay" />

      {/* Header */}
      <div className="border-b border-white/5 p-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/dashboard" className="text-gray-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-orange-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Admin Debug Panel</h1>
              <p className="text-sm text-gray-500">DO 状态 · 用户管理 · 任务监控</p>
            </div>
          </div>
          <Button onClick={load} variant="outline" className="border-white/10 text-white hover:bg-white/5">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />刷新
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Users */}
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Users className="w-5 h-5 text-purple-400" />用户列表 ({users.length})</h2>
          <div className="rounded-xl border border-white/5 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-white/5 text-gray-400">
                <th className="text-left p-3">ID</th><th className="text-left p-3">用户名</th><th className="text-left p-3">角色</th><th className="text-left p-3">创建时间</th>
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="p-3 font-mono text-xs text-gray-500">{u.id.substring(0, 8)}...</td>
                    <td className="p-3">{u.username}</td>
                    <td className="p-3"><span className={`px-2 py-1 rounded text-xs ${u.role === 'admin' ? 'bg-red-500/10 text-red-400' : 'bg-gray-500/10 text-gray-400'}`}>{u.role}</span></td>
                    <td className="p-3 text-gray-500">{u.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Tasks */}
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><ListTodo className="w-5 h-5 text-blue-400" />全部任务 ({tasks.length})</h2>
          <div className="space-y-2">
            {tasks.map(t => (
              <div key={t.id} className="rounded-xl border border-white/5 overflow-hidden">
                <div onClick={() => toggleTask(t)} className="flex items-center gap-4 p-4 hover:bg-white/5 cursor-pointer">
                  <span className={`px-2 py-1 rounded text-xs ${statusColor[t.status] || 'text-gray-400 bg-gray-500/10'}`}>{t.status}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{t.title || t.id}</div>
                    <div className="text-xs text-gray-500">by {t.username || t.user_id.substring(0, 8)} · {t.created_at}</div>
                  </div>
                  <span className="font-mono text-xs text-gray-500">{t.id.substring(0, 8)}</span>
                  {expandedTask === t.id ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                </div>

                {expandedTask === t.id && (
                  <div className="border-t border-white/5 p-4 bg-white/[0.02]">
                    {taskDetails[t.id] ? (
                      <div className="space-y-4">
                        {/* Plan */}
                        {taskDetails[t.id].plan && (
                          <div>
                            <h4 className="text-sm font-medium text-purple-400 mb-2">📋 Plan</h4>
                            <div className="space-y-1">
                              {taskDetails[t.id].plan!.map((s: any) => (
                                <div key={s.id} className="text-sm text-gray-400">
                                  {s.status === 'done' ? '✅' : s.status === 'running' ? '▶️' : '⬜'} {s.id}. {s.description}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Steps */}
                        <div>
                          <h4 className="text-sm font-medium text-blue-400 mb-2">🔧 Steps ({(taskDetails[t.id].steps as any[]).length})</h4>
                          <div className="space-y-1 max-h-60 overflow-y-auto">
                            {(taskDetails[t.id].steps as any[]).map((s: any, i: number) => (
                              <div key={i} className="text-xs font-mono p-2 rounded bg-white/5 text-gray-400">
                                [{i}] {s.action}({JSON.stringify(s.input).substring(0, 80)}) → {s.compactResult?.substring(0, 100)}...
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Messages count */}
                        <div className="text-xs text-gray-500">
                          💬 {(taskDetails[t.id].messages as any[]).length} messages in DO Storage
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">Loading DO data...</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Admin;
