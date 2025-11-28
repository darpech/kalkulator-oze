import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Calculator, Sun, Zap, TrendingUp, Calendar, DollarSign, Leaf, Info, ArrowRight, CheckCircle, Lightbulb, BarChart3, Settings, Battery, Printer, FileText } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line, ComposedChart, Area } from 'recharts';

// --- Helper Functions ---

const formatCurrency = (value) => {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(value);
};

// --- Constants ---

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const MONTHLY_PATTERN_PER_KWP = [
  { id: 1, name: 'Sty', full: 'Styczeń', value: 40 },
  { id: 2, name: 'Lut', full: 'Luty', value: 50 },
  { id: 3, name: 'Mar', full: 'Marzec', value: 75 },
  { id: 4, name: 'Kwi', full: 'Kwiecień', value: 95 },
  { id: 5, name: 'Maj', full: 'Maj', value: 115 },
  { id: 6, name: 'Cze', full: 'Czerwiec', value: 125 },
  { id: 7, name: 'Lip', full: 'Lipiec', value: 125 },
  { id: 8, name: 'Sie', full: 'Sierpień', value: 115 },
  { id: 9, name: 'Wrz', full: 'Wrzesień', value: 95 },
  { id: 10, name: 'Paź', full: 'Październik', value: 70 },
  { id: 11, name: 'Lis', full: 'Listopad', value: 50 },
  { id: 12, name: 'Gru', full: 'Grudzień', value: 40 },
];

// --- Calculation Logic ---

const calculateOzeMetrics = (scenario, globalParams) => {
  const { globalWibor, energyPriceBuy, energyPriceSell, energyInflation, productionPerKw, installationPower, effectiveAutoConsumptionPercent } = globalParams;

  // Investment Basics
  const totalInvestmentCost = parseFloat(scenario.totalCost) || 0; 
  const ownContribution = parseFloat(scenario.ownContribution) || 0; 
  const loanAmount = Math.max(0, totalInvestmentCost - ownContribution); 
  
  // Production Data
  const annualProduction = parseFloat(scenario.manualProduction) || (installationPower * productionPerKw);
  const selfConsumedEnergy = annualProduction * (effectiveAutoConsumptionPercent / 100);
  const soldEnergy = annualProduction - selfConsumedEnergy;

  // Financing Basics
  const periodMonths = parseInt(scenario.periodMonths) || 1;
  const graceMonths = parseInt(scenario.graceMonths) || 0;
  const commissionPercent = parseFloat(scenario.commissionPercent) || 0;
  const otherCosts = scenario.otherCosts.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);

  // Interest Rate
  let interestRate = 0;
  if (scenario.rateType === 'fixed') {
    interestRate = parseFloat(scenario.fixedRate) || 0;
  } else {
    interestRate = (parseFloat(scenario.margin) || 0) + globalWibor;
  }

  // Grant / Umorzenie
  let grantAmount = 0;
  if (scenario.grantType === 'percent') {
    grantAmount = totalInvestmentCost * ((parseFloat(scenario.grantValue) || 0) / 100);
  } else {
    grantAmount = parseFloat(scenario.grantValue) || 0;
  }

  // Monthly Loan Calculation
  const r = interestRate / 100 / 12;
  const repaymentMonths = periodMonths - graceMonths;
  let monthlyInstallments = new Array(periodMonths + 1).fill(0); 
  let currentBalance = loanAmount;
  let totalInterest = 0;
  const initialCommission = loanAmount * (commissionPercent / 100);

  if (loanAmount > 0) {
      for (let month = 1; month <= periodMonths; month++) {
        let interestPart = currentBalance * r;
        let capitalPart = 0;
        let installment = 0;

        if (month <= graceMonths) {
          installment = interestPart;
        } else {
          if (scenario.installmentType === 'equal') {
             if (r === 0) {
                capitalPart = currentBalance / (periodMonths - (month - 1));
                installment = capitalPart;
             } else {
                 const fixedInstallment = loanAmount * (r * Math.pow(1 + r, repaymentMonths)) / (Math.pow(1 + r, repaymentMonths) - 1);
                 installment = fixedInstallment;
                 capitalPart = installment - interestPart;
             }
          } else {
            capitalPart = loanAmount / repaymentMonths;
            installment = capitalPart + interestPart;
          }
        }
        
        if (month > graceMonths && (currentBalance - capitalPart < 1 || month === periodMonths)) {
             capitalPart = currentBalance;
             installment = capitalPart + interestPart;
        }

        currentBalance -= capitalPart;
        totalInterest += interestPart;
        monthlyInstallments[month] = installment;
      }
  }

  // Cash Flow Simulation (15 Years)
  const simulationYears = 15;
  let yearlyCashFlow = [];
  
  // Opportunity Cost Calculation
  const opportunityRate = energyInflation / 100;
  const futureValueOfOwnCapital = ownContribution * Math.pow(1 + opportunityRate, simulationYears);
  const totalOpportunityCost = futureValueOfOwnCapital - ownContribution;

  // Initial Cash Flow
  let cumulativeCashFlow = -(ownContribution + initialCommission + otherCosts) + grantAmount; 
  
  yearlyCashFlow.push({
    year: 0,
    energySavings: 0,
    loanPayment: 0,
    netCashFlow: cumulativeCashFlow,
    cumulative: cumulativeCashFlow
  });

  let paybackYear = null;

  for (let year = 1; year <= simulationYears; year++) {
    const currentEnergyPriceBuy = energyPriceBuy * Math.pow(1 + energyInflation / 100, year - 1);
    const currentEnergyPriceSell = energyPriceSell * Math.pow(1 + energyInflation / 100, year - 1);

    const savings = selfConsumedEnergy * currentEnergyPriceBuy;
    const revenue = soldEnergy * currentEnergyPriceSell;
    const totalBenefit = savings + revenue;

    let yearlyLoanCost = 0;
    const startMonth = (year - 1) * 12 + 1;
    const endMonth = year * 12;
    
    for (let m = startMonth; m <= endMonth; m++) {
      if (m <= periodMonths) {
        yearlyLoanCost += monthlyInstallments[m];
      }
    }

    const netFlow = totalBenefit - yearlyLoanCost;
    cumulativeCashFlow += netFlow;

    if (paybackYear === null && cumulativeCashFlow >= 0) {
      paybackYear = year;
    }

    yearlyCashFlow.push({
      year,
      energySavings: totalBenefit,
      loanPayment: yearlyLoanCost,
      netCashFlow: netFlow,
      cumulative: cumulativeCashFlow
    });
  }

  const totalCostOfLoan = totalInterest + initialCommission + otherCosts;
  const totalProjectCost = totalInvestmentCost + totalCostOfLoan + totalOpportunityCost - grantAmount;

  return {
    ...scenario,
    effectiveRate: interestRate,
    paybackYear,
    yearlyCashFlow,
    summary: {
      loanAmount,
      totalInterest,
      totalStartCosts: initialCommission + otherCosts,
      grantAmount,
      opportunityCost: totalOpportunityCost,
      totalProjectCost, 
      netProfit15Years: yearlyCashFlow[simulationYears].cumulative - totalOpportunityCost 
    }
  };
};

// --- Components ---

const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-visible print:border print:shadow-none ${className}`}>
    {children}
  </div>
);

const Tooltip = ({ text }) => (
  <div className="group relative inline-block ml-1 print:hidden">
    <Info className="w-4 h-4 text-slate-400 cursor-help" />
    <div className="invisible group-hover:visible absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-xs text-white bg-slate-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity w-64 text-center shadow-lg pointer-events-none">
      {text}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
    </div>
  </div>
);

export default function App() {
  // --- Global State ---
  const [globalWibor, setGlobalWibor] = useState(4.27);
  const [energyInflation, setEnergyInflation] = useState(3.0);
  
  // Tech Params
  const [installationPower, setInstallationPower] = useState(45); 
  const [productionPerKw, setProductionPerKw] = useState(1000); 
  
  // Autoconsumption Logic State
  const [consMethod, setConsMethod] = useState('percent');
  const [autoConsPercent, setAutoConsPercent] = useState(30); 
  
  const [fixedConsValue, setFixedConsValue] = useState(10);
  const [fixedConsPeriod, setFixedConsPeriod] = useState('daily');
  
  const [monthlyConsProfile, setMonthlyConsProfile] = useState(new Array(12).fill(200));

  // Prices
  const [energyPriceBuy, setEnergyPriceBuy] = useState(0.70); 
  const [energyPriceSell, setEnergyPriceSell] = useState(0.25); 

  const [activeTab, setActiveTab] = useState('input');
  const [selectedScenarioId, setSelectedScenarioId] = useState(null); 

  // --- Initial Scenarios Setup ---
  const [scenarios, setScenarios] = useState([
    {
      id: 1,
      name: 'Pożyczka OZE', 
      totalCost: 120000,
      storageCost: 20000,
      ownContribution: 0,
      periodMonths: 120, 
      graceMonths: 0,
      rateType: 'fixed', 
      fixedRate: 1.0,
      margin: 0,
      commissionPercent: 0,
      otherCosts: [],
      installmentType: 'equal', 
      grantType: 'amount',
      grantValue: 12000, // Pre-calculated: 10% of 120k loan (since storage > 12k)
      manualProduction: 0 
    },
    {
      id: 2,
      name: 'Kredyt komercyjny',
      totalCost: 120000,
      storageCost: 20000,
      ownContribution: 0, 
      periodMonths: 120, 
      graceMonths: 0,
      rateType: 'wibor',
      fixedRate: 0,
      margin: 2.5,
      commissionPercent: 2.0,
      otherCosts: [],
      installmentType: 'equal',
      grantType: 'amount',
      grantValue: 0,
      manualProduction: 0
    },
    {
      id: 3,
      name: 'Środki własne',
      totalCost: 120000,
      storageCost: 20000,
      ownContribution: 120000, 
      periodMonths: 1, 
      graceMonths: 0,
      rateType: 'fixed',
      fixedRate: 0,
      margin: 0,
      commissionPercent: 0,
      otherCosts: [],
      installmentType: 'equal',
      grantType: 'amount',
      grantValue: 0,
      manualProduction: 0
    }
  ]);

  // --- Handlers ---

  const handlePrint = () => {
    window.print();
  };

  const calculatedProduction = useMemo(() => {
    return installationPower * productionPerKw;
  }, [installationPower, productionPerKw]);

  // Updated Monthly Stats to strictly respect selected method
  const monthlyStats = useMemo(() => {
    return MONTHLY_PATTERN_PER_KWP.map((m, index) => {
        const production = m.value * installationPower; 
        let consumptionDemand = 0;

        // Exclusive logic depending on method
        if (consMethod === 'percent') {
            consumptionDemand = production * (autoConsPercent / 100);
        } else if (consMethod === 'fixed') {
            if (fixedConsPeriod === 'daily') {
                consumptionDemand = fixedConsValue * DAYS_IN_MONTH[index];
            } else if (fixedConsPeriod === 'monthly') {
                consumptionDemand = fixedConsValue;
            } else {
                consumptionDemand = fixedConsValue / 12;
            }
        } else if (consMethod === 'monthly') {
            consumptionDemand = parseFloat(monthlyConsProfile[index]) || 0;
        }

        // Logic check: Consumption cannot exceed Production in strict Net-Billing autoconsumption calc
        const consumed = Math.min(production, consumptionDemand);
        const sold = Math.max(0, production - consumed);
        
        const valueSaved = consumed * energyPriceBuy;
        const valueSold = sold * energyPriceSell;
        const totalValue = valueSaved + valueSold;

        return {
            ...m,
            production,
            consumptionDemand,
            consumed,
            sold,
            valueSaved,
            valueSold,
            totalValue
        };
    });
  }, [installationPower, consMethod, autoConsPercent, fixedConsValue, fixedConsPeriod, monthlyConsProfile, energyPriceBuy, energyPriceSell]);

  const effectiveAutoConsumptionPercent = useMemo(() => {
      const totalProd = monthlyStats.reduce((sum, item) => sum + item.production, 0);
      const totalCons = monthlyStats.reduce((sum, item) => sum + item.consumed, 0);
      return totalProd > 0 ? (totalCons / totalProd) * 100 : 0;
  }, [monthlyStats]);

  // Calculate annual totals for breakdown display
  const annualSavings = useMemo(() => monthlyStats.reduce((sum, item) => sum + item.valueSaved, 0), [monthlyStats]);
  const annualRevenue = useMemo(() => monthlyStats.reduce((sum, item) => sum + item.valueSold, 0), [monthlyStats]);

  const updateMonthlyProfile = (index, value) => {
      const newProfile = [...monthlyConsProfile];
      newProfile[index] = parseFloat(value) || 0;
      setMonthlyConsProfile(newProfile);
  };

  const addScenario = () => {
    const newId = Math.max(...scenarios.map(s => s.id), 0) + 1;
    setScenarios([...scenarios, {
      id: newId,
      name: `Opcja #${newId}`,
      totalCost: scenarios[0]?.totalCost || 120000,
      storageCost: 0,
      ownContribution: 0,
      periodMonths: 60,
      graceMonths: 0,
      rateType: 'wibor',
      fixedRate: 8.0,
      margin: 2.0,
      commissionPercent: 1.0,
      otherCosts: [],
      installmentType: 'equal',
      grantType: 'amount',
      grantValue: 0,
      manualProduction: 0
    }]);
  };

  const removeScenario = (id) => {
    if (scenarios.length > 1) {
      setScenarios(scenarios.filter(s => s.id !== id));
    }
  };

  const updateScenario = (id, field, value) => {
    setScenarios(prevScenarios => {
        const currentScenario = prevScenarios.find(s => s.id === id);
        const isMaster = currentScenario.name.includes('OZE');
        
        let newScenarios = prevScenarios.map(s => {
            if (s.id === id) {
                return { ...s, [field]: value };
            }
            if (isMaster && (field === 'totalCost' || field === 'storageCost')) {
                return { ...s, [field]: value };
            }
            return s;
        });

        return newScenarios.map(s => {
            let updatedS = { ...s };

            if (updatedS.name.toLowerCase().includes('własne') || updatedS.name.toLowerCase().includes('gotówka')) {
                updatedS.ownContribution = updatedS.totalCost;
            }

            // Logic for "Pożyczka OZE" (Grant calculation)
            if (updatedS.name.includes('OZE')) {
                const storageVal = parseFloat(updatedS.storageCost) || 0;
                if (storageVal > 0) {
                    const loanVal = Math.max(0, updatedS.totalCost - updatedS.ownContribution);
                    // 10% of Loan
                    let calculatedGrant = loanVal * 0.10;
                    
                    // Cap grant at storage cost
                    if (calculatedGrant > storageVal) {
                        calculatedGrant = storageVal;
                    }

                    updatedS.grantType = 'amount';
                    updatedS.grantValue = calculatedGrant;
                }
            }

            return updatedS;
        });
    });
  };

  const addOtherCost = (scenarioId) => {
    setScenarios(scenarios.map(s => {
      if (s.id === scenarioId) {
        return {
          ...s,
          otherCosts: [...s.otherCosts, { id: Date.now(), name: 'Dodatek', value: 0 }]
        };
      }
      return s;
    }));
  };

  const updateOtherCost = (scenarioId, costId, field, value) => {
    setScenarios(scenarios.map(s => {
      if (s.id === scenarioId) {
        const newCosts = s.otherCosts.map(c => c.id === costId ? { ...c, [field]: value } : c);
        return { ...s, otherCosts: newCosts };
      }
      return s;
    }));
  };

  const removeOtherCost = (scenarioId, costId) => {
    setScenarios(scenarios.map(s => {
      if (s.id === scenarioId) {
        return { ...s, otherCosts: s.otherCosts.filter(c => c.id !== costId) };
      }
      return s;
    }));
  };

  const fetchWibor = () => {
    alert("Pobrano aktualną stawkę WIBOR 3M z NBP (symulacja).");
    setGlobalWibor(4.27);
  };

  const globalParams = {
    globalWibor,
    energyPriceBuy,
    energyPriceSell,
    energyInflation,
    productionPerKw,
    installationPower,
    effectiveAutoConsumptionPercent,
    autoConsumption: effectiveAutoConsumptionPercent
  };

  const results = useMemo(() => {
    return scenarios.map(s => calculateOzeMetrics(s, globalParams));
  }, [scenarios, globalParams]);

  const bestOption = useMemo(() => {
    return results.reduce((prev, curr) => 
      (prev.summary.totalProjectCost < curr.summary.totalProjectCost) ? prev : curr
    );
  }, [results]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-12 print:bg-white print:pb-0">
      
      {/* Print Styling Block */}
      <style>{`
        @media print {
          @page { margin: 1cm; size: landscape; }
          .print\\:hidden { display: none !important; }
          .print\\:border { border: 1px solid #ddd; }
          .print\\:shadow-none { shadow: none; }
          body { -webkit-print-color-adjust: exact; }
        }
      `}</style>

      {/* Header */}
      <header className="bg-emerald-900 text-white p-6 shadow-lg sticky top-0 z-20 print:relative print:bg-emerald-900 print:text-white">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <Sun className="w-8 h-8 text-yellow-400" />
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Kalkulator Inwestycji OZE</h1>
                <p className="text-xs text-emerald-300 print:block hidden">Raport wygenerowany automatycznie</p>
            </div>
          </div>
          
          <div className="flex gap-4 items-center print:hidden">
            <div className="flex items-center gap-2 bg-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-700">
                <span className="text-xs font-medium text-emerald-200">WIBOR 3M:</span>
                <input 
                  type="number" value={globalWibor} onChange={(e) => setGlobalWibor(parseFloat(e.target.value))}
                  className="w-14 bg-white text-slate-900 px-1 py-0.5 rounded text-center font-bold text-sm"
                />
                <span className="text-xs">%</span>
            </div>

             <div className="flex items-center gap-2 bg-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-700">
                <span className="text-xs font-medium text-emerald-200 flex items-center gap-1">
                   Wzrost cen prądu <TrendingUp className="w-3 h-3" />
                </span>
                <input 
                  type="number" value={energyInflation} onChange={(e) => setEnergyInflation(parseFloat(e.target.value))}
                  className="w-14 bg-white text-slate-900 px-1 py-0.5 rounded text-center font-bold text-sm"
                />
                <span className="text-xs">% r/r</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
        
        {/* TOP SECTION: Installation Params */}
        <div className="lg:col-span-12">
            <Card className="bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
                <div className="p-4 md:p-6">
                    <h2 className="text-lg font-bold text-emerald-800 mb-4 flex items-center gap-2">
                        <Leaf className="w-5 h-5" /> Parametry Instalacji PV
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {/* Power & Production */}
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Moc instalacji (kWp)</label>
                                <input 
                                    type="number" value={installationPower} onChange={(e) => setInstallationPower(parseFloat(e.target.value))}
                                    className="w-full p-2 border border-emerald-300 rounded focus:ring-2 focus:ring-emerald-500 font-bold text-lg print:border-none print:bg-transparent print:p-0"
                                />
                            </div>
                            <div className="text-sm text-slate-600 bg-white p-2 rounded border border-emerald-100 shadow-sm print:border-none print:shadow-none print:pl-0">
                                <div className="text-xs text-slate-400 uppercase">Szacowana produkcja</div>
                                <div className="font-bold flex items-center gap-2">
                                    <Zap className="w-4 h-4 text-yellow-500" />
                                    {calculatedProduction.toLocaleString()} kWh/rok
                                </div>
                            </div>
                        </div>

                        {/* Prices */}
                        <div className="space-y-3">
                             <div>
                                <label className="text-xs text-slate-500 font-bold uppercase block mb-1">
                                    Cena zakupu energii
                                </label>
                                <div className="flex items-center">
                                    <input 
                                        type="number" step="0.01" value={energyPriceBuy} onChange={(e) => setEnergyPriceBuy(parseFloat(e.target.value))}
                                        className="w-full p-2 border border-slate-300 rounded-l print:border-none print:bg-transparent print:p-0"
                                    />
                                    <span className="bg-slate-200 px-3 py-2 rounded-r border border-l-0 border-slate-300 text-sm print:hidden">zł</span>
                                    <span className="hidden print:inline ml-1">zł/kWh</span>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 font-bold uppercase block mb-1">
                                    Cena sprzedaży (Net-billing)
                                </label>
                                <div className="flex items-center">
                                    <input 
                                        type="number" step="0.01" value={energyPriceSell} onChange={(e) => setEnergyPriceSell(parseFloat(e.target.value))}
                                        className="w-full p-2 border border-slate-300 rounded-l print:border-none print:bg-transparent print:p-0"
                                    />
                                    <span className="bg-slate-200 px-3 py-2 rounded-r border border-l-0 border-slate-300 text-sm print:hidden">zł</span>
                                    <span className="hidden print:inline ml-1">zł/kWh</span>
                                </div>
                            </div>
                        </div>

                        {/* Autoconsumption Advanced */}
                        <div className="md:col-span-2 bg-white p-3 rounded-lg border border-emerald-100 print:border-none">
                            <label className="text-xs text-slate-500 font-bold uppercase block mb-2">
                                Sposób obliczania autokonsumpcji
                            </label>
                            
                            {/* Method Tabs */}
                            <div className="flex gap-1 mb-3 bg-slate-100 p-1 rounded print:hidden">
                                <button 
                                    onClick={() => setConsMethod('percent')}
                                    className={`flex-1 text-xs py-1.5 rounded transition-colors ${consMethod === 'percent' ? 'bg-white shadow text-emerald-700 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    % Procentowo
                                </button>
                                <button 
                                    onClick={() => setConsMethod('fixed')}
                                    className={`flex-1 text-xs py-1.5 rounded transition-colors ${consMethod === 'fixed' ? 'bg-white shadow text-emerald-700 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    Stała wartość
                                </button>
                                <button 
                                    onClick={() => setConsMethod('monthly')}
                                    className={`flex-1 text-xs py-1.5 rounded transition-colors ${consMethod === 'monthly' ? 'bg-white shadow text-emerald-700 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    Profil miesięczny
                                </button>
                            </div>

                            {/* Method Inputs */}
                            {consMethod === 'percent' && (
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <span className="text-sm text-slate-600">Poziom autokonsumpcji:</span>
                                        <span className="font-bold text-emerald-700">{autoConsPercent}%</span>
                                    </div>
                                    <input 
                                        type="range" min="0" max="100" value={autoConsPercent} onChange={(e) => setAutoConsPercent(parseFloat(e.target.value))}
                                        className="w-full h-2 bg-emerald-200 rounded-lg appearance-none cursor-pointer accent-emerald-600 print:hidden"
                                    />
                                </div>
                            )}

                            {consMethod === 'fixed' && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] uppercase text-slate-400 font-bold">Zużycie w godz. produkcji</label>
                                        <input 
                                            type="number" value={fixedConsValue} onChange={(e) => setFixedConsValue(parseFloat(e.target.value))}
                                            className="w-full p-1.5 border border-slate-300 rounded text-sm print:border-none print:p-0"
                                        />
                                    </div>
                                    <div className="print:hidden">
                                        <label className="text-[10px] uppercase text-slate-400 font-bold">Okres</label>
                                        <select 
                                            value={fixedConsPeriod} onChange={(e) => setFixedConsPeriod(e.target.value)}
                                            className="w-full p-1.5 border border-slate-300 rounded text-sm bg-white"
                                        >
                                            <option value="daily">Dziennie (kWh)</option>
                                            <option value="monthly">Miesięcznie (kWh)</option>
                                            <option value="yearly">Rocznie (kWh)</option>
                                        </select>
                                    </div>
                                </div>
                            )}

                            {consMethod === 'monthly' && (
                                <>
                                <div className="text-[10px] text-slate-500 mb-1 italic">
                                    Wpisz szacowane zużycie energii w godzinach produkcji (kWh) dla każdego miesiąca:
                                </div>
                                <div className="grid grid-cols-6 gap-1 max-h-24 overflow-y-auto print:max-h-none print:overflow-visible">
                                    {MONTHLY_PATTERN_PER_KWP.map((m, idx) => (
                                        <div key={m.id}>
                                            <label className="text-[9px] uppercase text-slate-400 text-center block">{m.name}</label>
                                            <input 
                                                type="number" 
                                                value={monthlyConsProfile[idx]} 
                                                onChange={(e) => updateMonthlyProfile(idx, e.target.value)}
                                                className="w-full p-1 border border-slate-200 rounded text-[10px] text-center focus:border-emerald-500 print:border-none print:p-0"
                                            />
                                        </div>
                                    ))}
                                </div>
                                </>
                            )}

                            {/* Summary Calculation */}
                            <div className="mt-3 pt-2 border-t border-dashed border-emerald-200">
                                <div className="flex justify-between items-end mb-2">
                                    <div className="text-xs text-slate-500">Efektywna autokonsumpcja:</div>
                                    <div className="text-lg font-bold text-emerald-700 leading-none">
                                        {effectiveAutoConsumptionPercent.toFixed(1)}%
                                    </div>
                                </div>
                                <div className="flex justify-between text-xs gap-2">
                                    <div className="flex-1 bg-emerald-50 p-1.5 rounded border border-emerald-100 text-center">
                                        <div className="text-slate-500 text-[10px] uppercase">Oszczędzasz (Autokonsumpcja)</div>
                                        <div className="font-bold text-emerald-700">{formatCurrency(annualSavings)} / rok</div>
                                    </div>
                                    <div className="flex-1 bg-blue-50 p-1.5 rounded border border-blue-100 text-center">
                                        <div className="text-slate-500 text-[10px] uppercase">Sprzedajesz (Net-billing)</div>
                                        <div className="font-bold text-blue-700">{formatCurrency(annualRevenue)} / rok</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        </div>

        {/* Left Column: Financing Inputs - HIDDEN ON PRINT */}
        <div className="lg:col-span-5 space-y-6 print:hidden">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              Opcje Finansowania
            </h2>
            <button 
              onClick={addScenario}
              className="flex items-center gap-2 text-sm bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700 transition-all shadow-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Dodaj opcję
            </button>
          </div>

          <div className="space-y-4">
            {scenarios.map((scenario, index) => (
              <Card key={scenario.id} className="border-l-4 border-l-blue-500 relative">
                <div className="p-4">
                  <div className="flex justify-between items-start mb-4">
                    <input 
                      type="text" 
                      value={scenario.name}
                      onChange={(e) => updateScenario(scenario.id, 'name', e.target.value)}
                      className="font-bold text-lg text-blue-900 bg-transparent border-b border-transparent hover:border-blue-200 focus:border-blue-500 focus:outline-none w-full mr-2"
                      placeholder="Nazwa wariantu"
                    />
                    {scenarios.length > 1 && (
                      <button 
                        onClick={() => removeScenario(scenario.id)}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                        <label className="text-xs text-slate-500 font-semibold uppercase">Koszt instalacji (Brutto)</label>
                        <input 
                            type="number" 
                            value={scenario.totalCost}
                            onChange={(e) => updateScenario(scenario.id, 'totalCost', parseFloat(e.target.value))}
                            className="w-full p-2 border border-slate-300 rounded mt-1 focus:ring-2 focus:ring-blue-500 focus:outline-none font-bold"
                        />
                    </div>
                    {/* Storage Cost Field */}
                    <div className="col-span-2">
                        <label className="text-xs text-slate-500 font-semibold uppercase flex items-center gap-1">
                            w tym koszt magazynu energii
                            <Tooltip text="Jeśli koszt > 0, zwiększa to szansę na autokonsumpcję. W Pożyczce OZE może uruchomić umorzenie." />
                        </label>
                        <div className="relative">
                            <Battery className="w-4 h-4 text-emerald-500 absolute left-2 top-2.5" />
                            <input 
                                type="number" 
                                value={scenario.storageCost}
                                onChange={(e) => updateScenario(scenario.id, 'storageCost', parseFloat(e.target.value))}
                                className="w-full p-2 pl-8 border border-slate-200 bg-emerald-50/50 rounded mt-1 text-sm focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 focus:outline-none"
                                placeholder="0"
                            />
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 ml-1">
                            Możliwość umorzenia i zwiększenia autokonsumpcji
                        </div>
                    </div>

                     <div className="col-span-1">
                        <label className="text-xs text-slate-500 font-semibold uppercase">Wkład własny</label>
                        <input 
                            type="number" 
                            value={scenario.ownContribution}
                            onChange={(e) => updateScenario(scenario.id, 'ownContribution', parseFloat(e.target.value))}
                            className="w-full p-2 border border-slate-300 rounded mt-1 text-sm"
                            disabled={scenario.name.toLowerCase().includes('własne') || scenario.name.toLowerCase().includes('gotówka')}
                        />
                    </div>
                    <div className="col-span-1">
                        <label className="text-xs text-slate-500 font-semibold uppercase">Okres kredytu (m-ce)</label>
                        <input 
                            type="number" 
                            value={scenario.periodMonths}
                            onChange={(e) => updateScenario(scenario.id, 'periodMonths', parseInt(e.target.value))}
                            className="w-full p-2 border border-slate-300 rounded mt-1 text-sm"
                        />
                    </div>

                    {/* Interest Rate Section */}
                    <div className="col-span-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <div className="flex gap-4 mb-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input 
                            type="radio" 
                            name={`rateType-${scenario.id}`} 
                            checked={scenario.rateType === 'wibor'}
                            onChange={() => updateScenario(scenario.id, 'rateType', 'wibor')}
                            className="text-blue-600"
                          />
                          WIBOR + Marża
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input 
                            type="radio" 
                            name={`rateType-${scenario.id}`} 
                            checked={scenario.rateType === 'fixed'}
                            onChange={() => updateScenario(scenario.id, 'rateType', 'fixed')}
                            className="text-blue-600"
                          />
                          Stałe
                        </label>
                      </div>
                      
                      {scenario.rateType === 'wibor' ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="text-xs text-slate-500 block">Marża (%)</label>
                            <input 
                              type="number" step="0.01" value={scenario.margin} onChange={(e) => updateScenario(scenario.id, 'margin', parseFloat(e.target.value))}
                              className="w-full p-1.5 border rounded text-sm" 
                            />
                          </div>
                          <div className="text-xs text-slate-400 pt-4 self-center">+ {globalWibor}%</div>
                          <div className="flex-1 bg-blue-100 p-1.5 rounded text-center">
                            <label className="text-xs text-blue-600 font-bold block">Razem</label>
                            <span className="text-sm font-bold text-blue-800">{(globalWibor + (scenario.margin || 0)).toFixed(2)}%</span>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <label className="text-xs text-slate-500 block">Oprocentowanie stałe (%)</label>
                          <input 
                            type="number" step="0.01" value={scenario.fixedRate} onChange={(e) => updateScenario(scenario.id, 'fixedRate', parseFloat(e.target.value))}
                            className="w-full p-1.5 border rounded text-sm" 
                          />
                        </div>
                      )}
                    </div>

                    <div className="col-span-2 mt-2 pt-2 border-t border-dashed border-slate-300">
                      <div className="flex justify-between items-center mb-2">
                         <label className="text-xs font-bold text-emerald-600 uppercase">Dotacja / Umorzenie</label>
                         <select 
                            value={scenario.grantType} onChange={(e) => updateScenario(scenario.id, 'grantType', e.target.value)}
                            className="text-xs border rounded p-1"
                         >
                            <option value="amount">Kwota (PLN)</option>
                            <option value="percent">% Kosztów</option>
                         </select>
                      </div>
                      <input 
                        type="number" value={scenario.grantValue} onChange={(e) => updateScenario(scenario.id, 'grantValue', parseFloat(e.target.value))}
                        className="w-full p-2 border border-emerald-200 bg-emerald-50 rounded text-sm focus:ring-emerald-500 focus:border-emerald-500"
                        placeholder="np. 6000"
                      />
                    </div>
                  </div>
                  {/* Calculation Preview in Card */}
                  <div className="mt-3 text-xs text-slate-400 text-right">
                     Kwota kredytu: {formatCurrency(Math.max(0, scenario.totalCost - scenario.ownContribution))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Right Column: Results - EXPAND ON PRINT */}
        <div className="lg:col-span-7 flex flex-col gap-6 print:col-span-12">
          
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-1 print:hidden">
             <div className="grid grid-cols-4 gap-1">
                <button 
                  onClick={() => setActiveTab('input')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'input' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <Lightbulb className="w-4 h-4" />
                  Analiza Zwrotu
                </button>
                 <button 
                  onClick={() => setActiveTab('production')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'production' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <BarChart3 className="w-4 h-4" />
                  Produkcja Miesięczna
                </button>
                <button 
                  onClick={() => {
                    setActiveTab('schedule');
                    if (!selectedScenarioId) setSelectedScenarioId(scenarios[0].id);
                  }}
                  className={`py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'schedule' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <Calendar className="w-4 h-4" />
                  Przepływy Roczne
                </button>
                <button 
                  onClick={handlePrint}
                  className="py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 text-slate-600 hover:bg-slate-100 border-l border-slate-200"
                >
                  <Printer className="w-4 h-4" />
                  Pobierz PDF
                </button>
             </div>
          </div>

          {activeTab === 'input' && (
            <>
              {/* Winner Card */}
              <Card className="bg-gradient-to-br from-emerald-600 to-emerald-800 text-white border-none overflow-visible">
                 <div className="p-6 flex flex-col gap-6 relative">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full blur-3xl -mr-16 -mt-16 print:hidden"></div>
                    
                    <div className="flex justify-between items-start relative z-10">
                        <div>
                            <div className="flex items-center gap-2 text-emerald-200 text-xs font-bold uppercase tracking-widest mb-2">
                                <CheckCircle className="w-4 h-4" /> Najbardziej opłacalna opcja (Cash Flow)
                            </div>
                            <h3 className="text-4xl font-bold text-white">{bestOption.name}</h3>
                        </div>
                        <div className="bg-emerald-500/30 backdrop-blur-md border border-emerald-400/30 rounded-xl p-4 text-right min-w-[120px] print:border-white print:text-emerald-900 print:bg-white/90">
                            <div className="text-xs text-emerald-100 mb-1 print:text-emerald-800">Okres zwrotu</div>
                            <div className="text-3xl font-bold text-white print:text-emerald-900">
                                {bestOption.paybackYear ? `${bestOption.paybackYear} lat` : '> 15 lat'}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-emerald-500/30">
                        <div>
                            <div className="text-xs text-emerald-200 uppercase mb-1 opacity-80 print:text-emerald-100">Zysk "na czysto" po 15 latach</div>
                            <div className="text-2xl font-bold">{formatCurrency(bestOption.summary.netProfit15Years)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-emerald-200 uppercase mb-1 opacity-80 print:text-emerald-100">
                                Całkowity koszt inwestycji (Ekonomiczny)
                                <Tooltip text="Zawiera koszty instalacji, odsetki od kredytu ORAZ koszt utraconych korzyści z wkładu własnego." />
                            </div>
                            <div className="text-2xl font-bold">{formatCurrency(bestOption.summary.totalProjectCost)}</div>
                        </div>
                    </div>
                 </div>
              </Card>

              {/* Comparison Chart */}
              <Card className="p-6 h-96 print:h-80">
                 <h3 className="text-lg font-bold text-slate-800 mb-4">Symulacja skumulowanego zysku (15 lat)</h3>
                 <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={bestOption.yearlyCashFlow} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="year" label={{ value: 'Rok', position: 'insideBottomRight', offset: -5 }} />
                      <YAxis tickFormatter={(val) => `${val/1000}k`} />
                      <RechartsTooltip 
                        formatter={(value) => formatCurrency(value)}
                        labelFormatter={(label) => `Rok ${label}`}
                      />
                      <Legend />
                      <Area type="monotone" dataKey="cumulative" name="Skumulowany zysk (Cash Flow)" stroke="#059669" fill="#10b981" fillOpacity={0.2} strokeWidth={3} />
                      <Bar dataKey="loanPayment" name="Rata kredytu" fill="#f43f5e" barSize={20} />
                      <Line type="monotone" dataKey="energySavings" name="Wartość energii (Zysk)" stroke="#fbbf24" strokeWidth={2} dot={false} />
                    </ComposedChart>
                 </ResponsiveContainer>
              </Card>
              
              {/* Summary Table */}
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                      <tr>
                        <th className="p-4">Wariant</th>
                        <th className="p-4">Zwrot (lata)</th>
                        <th className="p-4 text-emerald-600">Zysk (15 lat)</th>
                        <th className="p-4 text-right">Koszt Całkowity</th>
                        <th className="p-4 text-slate-400 text-xs">
                            w tym utracone korzyści
                            <Tooltip text="To pieniądze, które Twoja gotówka zarobiłaby na lokacie, gdybyś nie wydał jej na instalację." />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {results.map(r => (
                        <tr key={r.id} className={r.id === bestOption.id ? "bg-emerald-50/50" : "hover:bg-slate-50"}>
                          <td className="p-4 font-bold text-slate-900">{r.name}</td>
                          <td className="p-4 font-medium">
                             {r.paybackYear ? <span className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded">{r.paybackYear} lat</span> : <span className="text-red-500">&gt;15 lat</span>}
                          </td>
                          <td className="p-4 text-emerald-600 font-bold">{formatCurrency(r.summary.netProfit15Years)}</td>
                          <td className="p-4 text-right font-medium text-slate-600">{formatCurrency(r.summary.totalProjectCost)}</td>
                          <td className="p-4 text-slate-400 text-xs">{formatCurrency(r.summary.opportunityCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          {activeTab === 'production' && (
              <div className="flex flex-col gap-6">
                   <Card className="p-6 h-96">
                        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                             <Zap className="w-5 h-5 text-yellow-500"/>
                             Produkcja vs Autokonsumpcja ({installationPower} kWp)
                        </h3>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={monthlyStats} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <RechartsTooltip 
                                    formatter={(value, name) => [`${value.toFixed(0)} kWh`, name === 'production' ? 'Produkcja' : 'Autokonsumpcja']}
                                />
                                <Legend />
                                <Bar dataKey="production" name="Produkcja (kWh)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="consumed" name="Zużycie (Auto)" fill="#10b981" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                   </Card>

                   <Card>
                       <div className="p-4 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-700">Szczegóły miesiąc po miesiącu</h3>
                       </div>
                       <div className="overflow-x-auto">
                           <table className="w-full text-sm text-right">
                               <thead className="bg-white text-slate-500 uppercase text-xs border-b">
                                   <tr>
                                       <th className="p-3 text-left">Miesiąc</th>
                                       <th className="p-3">Produkcja</th>
                                       <th className="p-3">Zapotrzebowanie</th>
                                       <th className="p-3 text-emerald-600 font-bold">Autokonsumpcja</th>
                                       <th className="p-3 text-blue-600">Sprzedaż</th>
                                   </tr>
                               </thead>
                               <tbody className="divide-y divide-slate-50 bg-white">
                                   {monthlyStats.map((row) => (
                                       <tr key={row.id} className="hover:bg-slate-50">
                                           <td className="p-3 text-left font-medium text-slate-700">{row.full}</td>
                                           <td className="p-3 text-slate-900 bg-yellow-50/30">{row.production.toFixed(0)} kWh</td>
                                           <td className="p-3 text-slate-500">{row.consumptionDemand.toFixed(0)} kWh</td>
                                           <td className="p-3 text-emerald-600 font-bold bg-emerald-50/30">{row.consumed.toFixed(0)} kWh</td>
                                           <td className="p-3 text-blue-600">{row.sold.toFixed(0)} kWh</td>
                                       </tr>
                                   ))}
                                   <tr className="bg-slate-100 font-bold border-t-2 border-slate-200">
                                        <td className="p-3 text-left text-slate-800">SUMA ROCZNA</td>
                                        <td className="p-3 text-slate-900">{(995 * installationPower).toLocaleString()} kWh</td>
                                        <td className="p-3 text-slate-500">-</td>
                                        <td className="p-3 text-emerald-700">{monthlyStats.reduce((sum, item) => sum + item.consumed, 0).toLocaleString()} kWh</td>
                                        <td className="p-3 text-blue-700">{monthlyStats.reduce((sum, item) => sum + item.sold, 0).toLocaleString()} kWh</td>
                                   </tr>
                               </tbody>
                           </table>
                       </div>
                   </Card>
              </div>
          )}

          {activeTab === 'schedule' && (
            <Card className="flex-1 flex flex-col h-[800px] print:h-auto">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 print:hidden">
                 <h3 className="font-bold text-slate-700">Analiza roczna</h3>
                 <select 
                   value={selectedScenarioId || ''}
                   onChange={(e) => setSelectedScenarioId(parseInt(e.target.value))}
                   className="p-2 border rounded text-sm bg-white shadow-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                 >
                    {scenarios.map(s => (
                       <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                 </select>
              </div>
              <div className="overflow-auto flex-1 p-0">
                 {selectedScenarioId && (
                   <table className="w-full text-sm text-right">
                      <thead className="bg-slate-100 text-slate-600 text-xs uppercase sticky top-0 z-10 shadow-sm">
                        <tr>
                           <th className="p-3 text-left">Rok</th>
                           <th className="p-3 text-emerald-600">Korzyść z Energii</th>
                           <th className="p-3 text-red-500">Rata Kredytu</th>
                           <th className="p-3 font-bold text-slate-900">Bilans Roczny</th>
                           <th className="p-3 text-blue-600">Skumulowane</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {results.find(r => r.id === selectedScenarioId)?.yearlyCashFlow.map((row) => (
                           <tr key={row.year} className={row.year === 0 ? "bg-slate-50 italic text-slate-500" : "hover:bg-slate-50"}>
                              <td className="p-3 text-left font-medium text-slate-700">{row.year === 0 ? "Start" : row.year}</td>
                              <td className="p-3 text-emerald-600">{formatCurrency(row.energySavings)}</td>
                              <td className="p-3 text-red-500">{row.loanPayment > 0 ? `-${formatCurrency(row.loanPayment)}` : '-'}</td>
                              <td className="p-3 font-bold text-slate-900">{formatCurrency(row.netCashFlow)}</td>
                              <td className={`p-3 font-bold ${row.cumulative >= 0 ? 'text-blue-600' : 'text-red-400'}`}>
                                {formatCurrency(row.cumulative)}
                              </td>
                           </tr>
                        ))}
                      </tbody>
                   </table>
                 )}
              </div>
            </Card>
          )}

          {/* Footer Disclaimer */}
          <div className="text-[10px] text-slate-400 mt-4 border-t pt-2">
            <p>
              <strong>Zastrzeżenie:</strong> Przedstawione wartości produkcji energii i korzyści finansowych mają charakter wyłącznie szacunkowy. Rzeczywiste wyniki mogą się różnić w zależności od wielu czynników, w tym: parametrów technicznych urządzeń, kąta nachylenia i azymutu paneli, lokalnych warunków pogodowych, zacienienia, zmian taryf energetycznych oraz indywidualnego profilu zużycia energii. Analiza nie stanowi oferty handlowej ani doradztwa inwestycyjnego.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}