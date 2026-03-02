import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Zap, ArrowLeft, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { API_BASE } from '@/lib/api';

// Particle Background
const ParticleBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      opacity: number;
    }> = [];

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 1,
        opacity: Math.random() * 0.5 + 0.2,
      });
    }

    let animationId: number;
    const animate = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      particles.forEach((particle, i) => {
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1;
        if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(127, 86, 217, ${particle.opacity})`;
        ctx.fill();

        particles.slice(i + 1).forEach((other) => {
          const dx = particle.x - other.x;
          const dy = particle.y - other.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 150) {
            ctx.beginPath();
            ctx.moveTo(particle.x, particle.y);
            ctx.lineTo(other.x, other.y);
            ctx.strokeStyle = `rgba(127, 86, 217, ${0.1 * (1 - distance / 150)})`;
            ctx.stroke();
          }
        });
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-0"
      style={{ background: 'linear-gradient(180deg, #000 0%, #050505 100%)' }}
    />
  );
};

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        leftRef.current,
        { opacity: 0, x: -50 },
        { opacity: 1, x: 0, duration: 1, ease: 'expo.out' }
      );
      gsap.fromTo(
        formRef.current,
        { opacity: 0, x: 50 },
        { opacity: 1, x: 0, duration: 1, delay: 0.2, ease: 'expo.out' }
      );
    }, containerRef);

    return () => ctx.revert();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '登录失败');
        setIsLoading(false);
        return;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.username);
      navigate('/dashboard');
    } catch {
      setError('网络错误，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="min-h-screen relative overflow-hidden">
      <ParticleBackground />
      <div className="noise-overlay" />

      {/* Gradient Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/15 rounded-full blur-[150px]" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-800/10 rounded-full blur-[120px]" />

      {/* Back Button */}
      <Link
        to="/"
        className="absolute top-6 left-6 z-20 flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        <span>返回首页</span>
      </Link>

      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Side - Branding */}
          <div ref={leftRef} className="hidden lg:block text-center lg:text-left">
            <Link to="/" className="inline-flex items-center gap-3 mb-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
                <Zap className="w-7 h-7 text-white" />
              </div>
              <span className="text-3xl font-bold text-white">Agents</span>
            </Link>
            <h1 className="text-4xl xl:text-5xl font-bold text-white mb-6 leading-tight">
              欢迎回来
              <br />
              <span className="gradient-text">继续您的旅程</span>
            </h1>
            <p className="text-lg text-gray-400 max-w-md">
              登录您的账户，继续与AI代理协作，提升工作效率。
            </p>
          </div>

          {/* Right Side - Form */}
          <div ref={formRef}>
            <div className="glass rounded-3xl p-8 md:p-10">
              {/* Mobile Logo */}
              <div className="lg:hidden text-center mb-8">
                <Link to="/" className="inline-flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-2xl font-bold text-white">Agents</span>
                </Link>
              </div>

              <h2 className="text-2xl font-bold text-white mb-2">登录账户</h2>
              <p className="text-gray-400 mb-8">输入您的凭证以继续</p>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-gray-300">
                    用户名
                  </Label>
                  <Input
                    id="email"
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 h-12 rounded-xl focus:border-purple-500 focus:ring-purple-500/20"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-gray-300">
                    密码
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder=""
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 h-12 rounded-xl pr-12 focus:border-purple-500 focus:ring-purple-500/20"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 rounded border-white/20 bg-white/5 text-purple-600" />
                    <span className="text-sm text-gray-400">记住我</span>
                  </label>
                  <a href="#" className="text-sm text-purple-400 hover:text-purple-300 transition-colors">
                    忘记密码？
                  </a>
                </div>

                {error && (
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white h-12 rounded-xl text-lg font-semibold magnetic-btn animate-pulse-glow disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 w-5 h-5 animate-spin" />
                      登录中...
                    </>
                  ) : (
                    '登录'
                  )}
                </Button>
              </form>

              <div className="mt-8 text-center">
                <p className="text-gray-400 text-sm">
                  还没有账户？{' '}
                  <a href="#" className="text-purple-400 hover:text-purple-300 transition-colors">
                    联系销售团队
                  </a>
                </p>
                </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
