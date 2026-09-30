Tasks and Phases 
# in PLAN phase: must shown trucks (came from transport api) transport part, loading part (gaplama) 
1. Weekly Plan , Hepdelik plan. role greenhouse manager, every friday task must come , after friday if task not filled msut be red, deadline until sunday
2. Truck Allocation, Hepdelik maşyn planlama. role : export manager (gadam). every sunday task must be came, deadline saturday, also if greenhouse manager change or fill after truck allocation the task must be came to be review Truck allocation greenhouse weekly plan changed.  Done when filled full. Trigger weekly plan
3. Transport Truck Planning, Transport maşyn  planlamasy. role: transport; saturday after truck allocation filled, if truck allocation change must came again with review; Must open and see truck Allocation then to be done task press button Reviewed (Tanyşdym). TRIGGER truck allocation
Transport Truck Planning is 
4. Shipment planning, Ýük planla. role: Loading Dept Head, deputy (can we done with one of that) . Şügüne ýük , maşyn planla, pressed button and opens export/gaplama (Packing). when opens one truck it must be done auto. task must come Everyday   except sunday.
5. Export planning, Eksport planla. role: export manager (gadam). every day except sunday; Must open new shipment , after task auto done
Shipment related tasks:
5. After shipment opened.  if there are : country, customer or import firm, shipment type is not filled then must be task for export manager (gadam) task to fill them, done after filled. trigger shipment creation. export code or system code : Eksport maglumatlaryny dolduryň ;
# export manager opened shipments starts PREPS phase

6. After 5 done . Join supply planned. Ýükleme bölek birikdir/ role: export manager (gadam). per shipment.opens assigment board after joing must be task done
7. After 5 done. Fill export firm. role: document team. 
after this task is differnt for shipment regular type and shipment gapy satys. for gapy satys i will write Gapy satys another is for both, if for regular only I will say
8.1 For Regular,  After 5 done. Choose truck . Must choose truck for shipment from aviable truck (this part is not realized yet)  role: export manager (gadam). per shipment
8.2. Gapy satys: Fill transort details. role:document type. must fill driverm truck plate, driver phone.
# PREPS phase ends after 8 transport set, ANDS STARTS docs
9. After export firm selected. Choose or create contract and download. role document team
10. Fill gross net.  After export firm selected trigger. role document team
11. Print, prepare transport documents. for regular must open print transport doc modal or screen ((this part is not realized yet)) . For gapy stays only button tayynladym. before this must be 8. There Resminamalar 13:00 must be auto picked Dowam edyar
12. Print CMR. before this task must be done 11,10,9. role document team. trigger after 11 we can say
13. print Tir carnet. role document team. trigger after 11 we can say
14. Prepare, print  CT-1 (origin). role document team. after 12
15. Prepare, print  Phytosanitary. role document team. after 14
16. CT-1 (origin), Phytosanitary letter sent. button done. role document team. adter 14,15 done
17. Print Customs request.role document team. after 12
18. Resminamalary peçada ugradyldy. role document team
19. Resminamalar peçatdan geldi. role document team. after 18
20. Give advance for shipment. role Financier
21. Deklarasiýa taýynla. button done.  role document team
21. Resminamalar gümrüge ugradyldy. role document team
22. Resminamalar gümrükden geldi. role document team. Resminmalar 13:00 row set Gümrükden geldi auto
# Docs phase ends here AND starts LOAD PHASE
23. Ýyladyşhana girdi. role: garawul (now preparing this)
Loading Phase starts here
24. Loading Started, must write timestap, and fill Block Sources
Variety Net weight. role: 
25. Fill Food Certificate Quality Certificate, Calibration Analysis ,Transit days, Transport temperature , Shelf life (days) . role Quality Inspector.
26. Loading ended, must write timestap.
27. Ýyladyşhanadan cykdy. role: garawul (now preparing this)

# LOAD phase end; there for gapy satysh phase , status is close, for regular starts TRANSIT phase
28. TM çäginden çykan wagty. role transport 
# TRANSIT phase end; started DEST
29. Barmaly ýurdyna giren wagty. role: sales rep (Qr scan must work here)
30. Gümrük işlerini edilen wagty. role: sales rep (Qr scan must work here)
31. Ask Peregruz ýagdaýy . role: sales rep
if pregruz 
32.  Peregruz bolan wagty. role: sales rep
33. Barmaly nokadyna gelen wagty. role: sales rep (Qr scan must work here)
34. Starts sales. (Qr scan must work here)
35. Sales end . (Qr scan must work here). role: sales rep
36. Hasabat doldur. role: sales rep. must fill report
37. Hasabaty gözden geçir we tassykla. role: export manager (aganazar) after ok close
# DEST ends and phase CLOSE all done





