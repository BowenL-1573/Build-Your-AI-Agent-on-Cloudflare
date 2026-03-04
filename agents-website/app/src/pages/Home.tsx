import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowRight, Zap, Brain, Shield, Globe, ChevronRight, Bot, Container } from 'lucide-react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';

// Particle Background Component
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

    for (let i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
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
      style={{ background: 'linear-gradient(180deg, #000 0%, #0a0a0a 100%)' }}
    />
  );
};

// Hero Section
const HeroSection = () => {
  const heroRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        titleRef.current,
        { opacity: 0, y: 50, rotateX: 45 },
        { opacity: 1, y: 0, rotateX: 0, duration: 1.2, delay: 0.2, ease: 'expo.out' }
      );
      gsap.fromTo(
        subtitleRef.current,
        { opacity: 0, y: 30 },
        { opacity: 1, y: 0, duration: 0.8, delay: 0.5, ease: 'expo.out' }
      );
      gsap.fromTo(
        buttonsRef.current,
        { opacity: 0, y: 40 },
        { opacity: 1, y: 0, duration: 0.8, delay: 0.8, ease: 'back.out(1.7)' }
      );
    }, heroRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={heroRef} className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <ParticleBackground />

      {/* Gradient Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-800/15 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />

      <div className="relative z-10 text-center px-4 max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-8 animate-float">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm text-gray-300">Compute-Storage Separation Demo</span>
        </div>

        <h1
          ref={titleRef}
          className="text-5xl md:text-7xl lg:text-8xl font-bold mb-6 leading-tight"
          style={{ perspective: '1000px' }}
        >
          <span className="gradient-text">Web Research Agent</span>
          <br />
          <span className="text-white">on Cloudflare</span>
        </h1>

        <p ref={subtitleRef} className="text-xl md:text-2xl text-gray-400 mb-10 max-w-2xl mx-auto">
          Pages · Workers · Durable Objects · Workflows · Container · AI Gateway · R2
          <br />
          全栈 Cloudflare 构建的 AI Agent 架构演示
        </p>

        <div ref={buttonsRef} className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/dashboard" data-track="hero-start-experience">
            <Button
              size="lg"
              className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-6 text-lg rounded-xl magnetic-btn animate-pulse-glow"
              data-track="hero-start-experience-button"
            >
              开始体验
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        <span className="text-xs text-gray-500">向下滚动</span>
        <div className="w-6 h-10 rounded-full border-2 border-gray-600 flex justify-center pt-2">
          <div className="w-1.5 h-3 bg-purple-500 rounded-full animate-bounce" />
        </div>
      </div>
    </section>
  );
};

// Architecture Section
const ArchitectureSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);

  const layers = [
    {
      name: '前端层',
      tech: 'Cloudflare Pages',
      description: 'React SPA 部署在边缘，全球低延迟访问，WebSocket 实时通信',
      color: 'from-blue-500/20 to-cyan-500/20',
      borderColor: 'border-blue-500/30',
    },
    {
      name: 'API 与状态层',
      tech: 'Workers + Durable Objects',
      description: 'Worker 处理路由与认证，DO 管理 Agent 会话状态与 WebSocket 长连接',
      color: 'from-purple-500/20 to-pink-500/20',
      borderColor: 'border-purple-500/30',
    },
    {
      name: '编排层',
      tech: 'Workflows',
      description: 'Workflow 编排 plan → review → execute 循环，管理 Agent 状态与审批流程',
      color: 'from-orange-500/20 to-red-500/20',
      borderColor: 'border-orange-500/30',
    },
    {
      name: '执行与存储层',
      tech: 'Container + AI Gateway + Workers AI + R2',
      description: 'Sandbox 隔离执行工具（Playwright/Python），AI Gateway 调度 LLM，Workers AI 运行 GLM-4.7，R2 存储截图零出网费',
      color: 'from-green-500/20 to-emerald-500/20',
      borderColor: 'border-green-500/30',
    },
  ];

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.arch-card',
        { opacity: 0, y: 80 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          stagger: 0.15,
          ease: 'expo.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 80%',
          },
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-32 px-4 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            <span className="text-white">全栈</span>
            <span className="gradient-text"> 架构</span>
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            从前端到 AI 推理，全部运行在 Cloudflare 全球网络
          </p>
        </div>

        <div className="mb-12 rounded-2xl overflow-hidden glass border border-purple-500/30">
          <img src="/images/Architecture-on-Cloudlfare.png" alt="CF-Agent Architecture" className="w-full" />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {layers.map((layer, i) => (
            <div
              key={i}
              className={`arch-card p-8 rounded-2xl glass border ${layer.borderColor} hover:scale-105 transition-transform duration-500`}
            >
              <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${layer.color} opacity-50`} />
              <div className="relative z-10">
                <div className="text-sm text-gray-500 mb-2">{layer.tech}</div>
                <h3 className="text-xl font-semibold text-white mb-3">{layer.name}</h3>
                <p className="text-gray-400 leading-relaxed">{layer.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// Features Section
const FeaturesSection = () => {
  const featuresRef = useRef<HTMLDivElement>(null);
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);

  const features = [
    {
      icon: Globe,
      title: '全栈一站式',
      description: '从前端托管、API 路由、状态管理到 AI 推理和对象存储，7 个产品组合覆盖 Agent 全链路，无需拼凑多云服务。',
      color: 'from-blue-500/20 to-cyan-500/20',
    },
    {
      icon: Brain,
      title: '原生 AI 能力',
      description: 'Workers AI 内置大模型推理，AI Gateway 提供缓存、限流和可观测性，Sandbox 安全运行任意代码和浏览器。',
      color: 'from-purple-500/20 to-pink-500/20',
    },
    {
      icon: Shield,
      title: '可靠且低成本',
      description: 'Workflows 持久化编排确保长任务可靠完成，R2 零出网费大幅降低存储成本，全球边缘网络保障低延迟访问。',
      color: 'from-green-500/20 to-emerald-500/20',
    },
  ];

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.feature-card',
        { opacity: 0, y: 80 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          stagger: 0.15,
          ease: 'expo.out',
          scrollTrigger: {
            trigger: featuresRef.current,
            start: 'top 80%',
          },
        }
      );
    }, featuresRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={featuresRef} className="py-32 px-4 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            <span className="text-white">为什么选择</span>
            <span className="gradient-text"> Cloudflare</span>
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            解决 AI Agent 构建的三个核心挑战
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {features.map((feature, i) => (
            <div
              key={i}
              className="feature-card relative group"
              onMouseEnter={() => setHoveredCard(i)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <div
                className={`relative p-8 rounded-2xl glass tilt-card transition-all duration-500 ${
                  hoveredCard === i ? 'scale-105' : ''
                }`}
                style={{
                  transform: hoveredCard === i ? 'perspective(1000px) rotateX(5deg) rotateY(-5deg)' : 'none',
                }}
              >
                <div
                  className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
                />
                <div className="relative z-10">
                  <div className="w-14 h-14 rounded-xl bg-purple-600/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <feature.icon className="w-7 h-7 text-purple-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-4">{feature.title}</h3>
                  <p className="text-gray-400 leading-relaxed">{feature.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// How It Works Section
const HowItWorksSection = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  const steps = [
    {
      name: '用户输入任务',
      description: '通过 Pages 前端发送自然语言研究任务，WebSocket 连接到 Worker',
      color: 'from-purple-600 to-pink-600',
      image: '/images/workflow/step1.png',
    },
    {
      name: 'Agent 制定计划',
      description: 'Workflow 调用 Workers AI (GLM-4.7) 生成结构化研究计划，用户可审核、修改或直接执行',
      color: 'from-blue-600 to-cyan-600',
      image: '/images/workflow/step2.png',
    },
    {
      name: 'Workflow 编排执行',
      description: 'Workflow 驱动 ReAct 循环（最多 30 步），调度 Sandbox 执行搜索、浏览器抓取、Python 数据处理等工具',
      color: 'from-orange-600 to-red-600',
      image: '/images/workflow/step3.png',
    },
    {
      name: '生成研究报告',
      description: 'Agent 综合所有信息撰写结构化报告，截图存储到 R2，结果实时推送到前端',
      color: 'from-green-600 to-emerald-600',
      image: '/images/workflow/step4.png',
    },
  ];

  return (
    <section className="py-32 px-4 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            工作<span className="gradient-text">流程</span>
          </h2>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 items-start">
          <div className="space-y-4">
            {steps.map((step, i) => (
              <button
                key={i}
                onClick={() => setActiveStep(i)}
                data-track={`workflow-step-${i + 1}`}
                className={`w-full text-left p-6 rounded-xl transition-all duration-500 ${
                  activeStep === i
                    ? 'glass border-purple-500/50'
                    : 'hover:bg-white/5 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${step.color} flex items-center justify-center text-white text-sm font-bold`}>
                      {i + 1}
                    </div>
                    <div>
                      <h3 className={`text-lg font-semibold mb-1 ${activeStep === i ? 'text-white' : 'text-gray-400'}`}>
                        {step.name}
                      </h3>
                      <p className={`text-sm ${activeStep === i ? 'text-gray-300' : 'text-gray-500'}`}>
                        {step.description}
                      </p>
                    </div>
                  </div>
                  <ChevronRight
                    className={`w-5 h-5 transition-transform duration-300 ${
                      activeStep === i ? 'rotate-90 text-purple-400' : 'text-gray-600'
                    }`}
                  />
                </div>
              </button>
            ))}
          </div>

          <div className="relative">
            <div
              className="relative rounded-2xl overflow-hidden glass-strong cursor-pointer group"
              style={{ height: '480px' }}
              onClick={() => setLightbox(true)}
              data-track="workflow-image-lightbox"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${steps[activeStep].color} opacity-10`} />
              <img
                src={steps[activeStep].image}
                alt={steps[activeStep].name}
                className="w-full h-full object-contain p-3 transition-transform duration-500"
              />
              <div className="absolute bottom-3 right-3 text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">点击放大</div>
            </div>
          </div>
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8 cursor-pointer" onClick={() => setLightbox(false)}>
          <img
            src={steps[activeStep].image}
            alt={steps[activeStep].name}
            className="max-w-full max-h-full object-contain rounded-xl"
          />
        </div>
      )}
    </section>
  );
};

// Production Architecture Section
const ProductionArchSection = () => {
  const items = [
    {
      title: 'Sandbox 实例池 + 会话隔离',
      current: '已实现：10 个 Sandbox 实例池（sandbox-0 到 sandbox-9），按 taskId 哈希路由，每个任务创建独立 Session 隔离环境变量和工作目录',
      production: '进一步优化：结合 Sandbox SDK 的 keepAlive 选项保持长任务容器存活，使用 sleepAfter 配置自动休眠策略，降低闲置成本',
      icon: '🏗️',
    },
    {
      title: 'Sandbox SDK 原生能力',
      current: '已实现：exec() 命令执行、readFile/writeFile 文件操作、createSession() 会话管理、WebSocket transport 避免 subrequest 限制',
      production: 'SDK 已支持：Code Interpreter API（createCodeContext + runCode）执行 Python/JS 并返回图表；watch() 监听文件变更；gitCheckout() 克隆仓库；terminal() 提供浏览器终端',
      icon: '📦',
    },
    {
      title: '进程管理与服务编排',
      current: '已实现：主实例 2 次重试后自动 failover 到其他实例，3 秒间隔指数退避，确保单实例故障不影响任务执行',
      production: 'SDK 已支持：startProcess() + waitForPort()/waitForLog() 管理长运行服务并等待就绪；exposePort() 生成预览 URL 暴露服务；streamProcessLogs() 实时流式监控',
      icon: '⚡',
    },
    {
      title: '存储与持久化',
      current: '已实现：截图上传 R2、任务结果写入 Sandbox 文件系统、Session 环境变量传递 API Keys',
      production: 'SDK 已支持：mountBucket() 将 R2/S3 挂载为本地目录，读写透明持久化；createBackup() 将工作区快照为 squashfs 归档存入 R2，restoreBackup() 通过 FUSE copy-on-write 秒级恢复，支持自定义 TTL 和命名快照',
      icon: '❄️',
    },
  ];

  return (
    <section className="py-32 px-4 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            <span className="text-white">Sandbox SDK</span>
            <span className="gradient-text"> 架构演进</span>
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            基于 Cloudflare Sandbox SDK 的生产级隔离执行方案
          </p>
        </div>

        <div className="space-y-6">
          {items.map((item, i) => (
            <div key={i} className="p-8 rounded-2xl glass border border-white/10 hover:border-purple-500/30 transition-all duration-300">
              <div className="flex items-start gap-6">
                <div className="text-4xl">{item.icon}</div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-white mb-4">{item.title}</h3>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <div className="text-sm text-green-400 mb-2 uppercase tracking-wider">✓ 当前实现</div>
                      <p className="text-gray-300">{item.current}</p>
                    </div>
                    <div>
                      <div className="text-sm text-purple-400 mb-2 uppercase tracking-wider">→ SDK 能力</div>
                      <p className="text-gray-400">{item.production}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* SDK Feature Reference */}
        <div className="mt-12 p-6 rounded-xl glass border border-white/10">
          <h4 className="text-lg font-semibold text-white mb-4">核心 SDK</h4>
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <a href="https://developers.cloudflare.com/agents/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-4 rounded-lg border border-white/10 hover:border-purple-500/40 transition-all group">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-white font-semibold group-hover:text-purple-400 transition-colors">Agents SDK</div>
                <div className="text-gray-400 text-sm">Agent 编排框架 — DO 状态管理、WebSocket 通信、Workflow 编排、Human-in-the-loop</div>
              </div>
              <div className="text-gray-500 group-hover:text-purple-400 ml-auto">↗</div>
            </a>
            <a href="https://developers.cloudflare.com/sandbox/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-4 rounded-lg border border-white/10 hover:border-purple-500/40 transition-all group">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shrink-0">
                <Container className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-white font-semibold group-hover:text-purple-400 transition-colors">Sandbox SDK</div>
                <div className="text-gray-400 text-sm">安全执行环境 — 隔离容器、命令执行、文件系统、会话管理、代码解释器</div>
              </div>
              <div className="text-gray-500 group-hover:text-purple-400 ml-auto">↗</div>
            </a>
          </div>
          <h5 className="text-sm text-gray-500 uppercase tracking-wider mb-3">Sandbox SDK API 一览</h5>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-purple-400 font-mono mb-1">命令执行</div>
              <div className="text-gray-400">exec() · execStream() · startProcess()</div>
            </div>
            <div>
              <div className="text-purple-400 font-mono mb-1">文件操作</div>
              <div className="text-gray-400">readFile() · writeFile() · gitCheckout()</div>
            </div>
            <div>
              <div className="text-purple-400 font-mono mb-1">会话管理</div>
              <div className="text-gray-400">createSession() · setEnvVars()</div>
            </div>
            <div>
              <div className="text-purple-400 font-mono mb-1">代码解释器</div>
              <div className="text-gray-400">createCodeContext() · runCode()</div>
            </div>
            <div>
              <div className="text-purple-400 font-mono mb-1">存储挂载</div>
              <div className="text-gray-400">mountBucket() · createBackup()</div>
            </div>
            <div>
              <div className="text-purple-400 font-mono mb-1">服务暴露</div>
              <div className="text-gray-400">exposePort() · terminal()</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// CTA Section
const CTASection = () => {
  return (
    <section className="py-32 px-4 relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-600/20 rounded-full blur-[150px] animate-pulse" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto text-center">
        <h2 className="text-4xl md:text-6xl font-bold text-white mb-6">
          体验
          <span className="gradient-text"> 全栈 Cloudflare</span>
          <br />
          Agent 实际效果
        </h2>
        <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          输入一个研究任务，看 Agent 如何在 Cloudflare 上完成规划、搜索与报告生成
        </p>
        <Link to="/dashboard" data-track="cta-start-demo">
          <Button
            size="lg"
            className="bg-purple-600 hover:bg-purple-700 text-white px-10 py-7 text-xl rounded-xl magnetic-btn animate-pulse-glow"
            data-track="cta-start-demo-button"
          >
            开始 Demo
            <ArrowRight className="ml-2 w-6 h-6" />
          </Button>
        </Link>
      </div>
    </section>
  );
};

// Footer
const Footer = () => {
  return (
    <footer className="py-16 px-4 border-t border-white/5">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white">CF-Agent Demo</span>
          </div>

          <div className="text-gray-500 text-sm">
            Powered by Pages · Workers · Durable Objects · Workflows · Container · AI Gateway · R2
          </div>
        </div>
      </div>
    </footer>
  );
};

// Navigation
const Navigation = () => {
  const [scrolled, setScrolled] = useState(false);
  const loggedIn = !!localStorage.getItem('token');

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled ? 'glass-strong py-4' : 'py-6'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3" data-track="nav-home-logo">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white">CF-Agent</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <a href="#architecture" className="text-gray-300 hover:text-white transition-colors" data-track="nav-architecture">架构</a>
          <a href="#features" className="text-gray-300 hover:text-white transition-colors" data-track="nav-features">优势</a>
          <a href="#how-it-works" className="text-gray-300 hover:text-white transition-colors" data-track="nav-how-it-works">流程</a>
          <a href="#production-arch" className="text-gray-300 hover:text-white transition-colors" data-track="nav-production-arch">Sandbox 架构</a>
        </div>

        <div className="flex items-center gap-3">
          {loggedIn && (
            <Link to="/dashboard" data-track="nav-dashboard">
              <Button className="bg-purple-600 hover:bg-purple-700 text-white" data-track="nav-dashboard-button">
                进入控制台
              </Button>
            </Link>
          )}
          <Link to="/login" data-track="nav-login">
            <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" data-track="nav-login-button">
              {loggedIn ? '切换账户' : '登录'}
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  );
};

// Main Home Component
const Home = () => {
  return (
    <div className="min-h-screen bg-black">
      <div className="noise-overlay" />
      <Navigation />
      <HeroSection />
      <section id="architecture">
        <ArchitectureSection />
      </section>
      <section id="features">
        <FeaturesSection />
      </section>
      <section id="how-it-works">
        <HowItWorksSection />
      </section>
      <section id="production-arch">
        <ProductionArchSection />
      </section>
      <CTASection />
      <Footer />
    </div>
  );
};

export default Home;
