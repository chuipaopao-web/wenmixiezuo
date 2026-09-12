/** Stable storage shape; richer guidance does not turn source summaries into invented plans. */
export const TIME_MACHINE_CARD_TEMPLATE_REVISION='tm2-card-4';
export const timeMachineCardContract=`返回JSON {"fields":{"premise":[],"protagonists":[],"world":[],"openingEnding":[],"preferences":[],"prohibitions":[]}}。
每条为{"text":"有依据的完整资料要点","sourceKeys":["原始来源key"]}。按以下六栏整理：
premise：题材及融合题材、作品核心构想、storyDirection故事方向、独有卖点与已有核心矛盾。
protagonists：主角及影响全书的核心人物，分别保留姓名身份、开局处境、动机目标、能力及触发条件/限制、重要关系；群像不能只保留一个人。
world：真正影响故事展开的世界秩序、力量边界、势力矛盾和关键资源条件；普通价格、无关地名不必搬入。
openingEnding：作者已确定的开局、结局方向和必须发生的节点，说明是未来要求而非已发生事实；没有结局就留空，不替作者设计。
preferences：目标篇幅、节奏、情绪、语言与感情偏好；剧情方向放premise，不误放本栏。
prohibitions：作者明确禁止项与不可突破的前提，保留适用条件，不把局部限制扩大成全书通则。
只整理资料确有的信息，未知保持空，不补造、不提前生成故事线或分卷。每条保留主体、条件、因果、例外；短而完整，不机械限制每栏条数和每条八十字。去除重复，不能因追求简短丢失关键条件。
输出前自行核对：每条是否有原文依据，人物和能力条件是否遗漏，未来目标是否误写为事实；直接纠正后输出，不输出自查过程。不扩写题材理论、方法论、故事线建议或资料未给出的经历；资料少就少写，不设最低字数。
最终六栏含JSON和来源标记建议控制在6000字符左右，这是资料部分的软预算，不是完整请求上限，不凑满。全部调用输入（岗位、格式、资料、方法、工具结果等）上限15000字符。书籍资料为主体，方法不是本书事实。`;

export function planningMaterial(fields:unknown,intent:string,methods?:unknown):string {
 // Callers supply parsed card fields. Provenance stays in the stored/reviewed card;
 // recommendation and skeleton output do not require source IDs on every statement.
 const semanticFields=Object.fromEntries(Object.entries(fields as Record<string,{text:string}[]>).map(([key,claims])=>[key,claims.map(claim=>claim.text)]));
 return JSON.stringify({bookMaterial:{status:'已确认来源的摘要，遗漏不代表不存在',fields:semanticFields},storylineIntent:{status:'作者选择与补充，属于未来设计要求，不是正文事实',text:intent},...(methods===undefined?{}:{methodReference:{status:'成员选用的方法和补查资料；方法可选，不作为本书事实',content:methods}})});
}
